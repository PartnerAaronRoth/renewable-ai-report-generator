"""
Gemini API proxy endpoints - handles all frontend Gemini requests
"""
from litestar import post, get, Request, Response
from litestar.datastructures import State, UploadFile
from litestar.enums import RequestEncodingType
from litestar.params import Body
from pydantic import BaseModel
from typing import Optional, List, Any
import base64
import time
from pathlib import Path

from google import genai
from google.genai import types
from auth import decode_access_token
from litestar.exceptions import NotAuthorizedException, HTTPException
from litestar.status_codes import HTTP_429_TOO_MANY_REQUESTS
from database import get_db, UsageLog
from usage_tracker import check_usage_limit, add_user_usage
from logging_config import log_api_request, log_error


# === Pydantic Models ===

class AnalysisResult(BaseModel):
    documentTypes: List[str]
    title: str
    date: str
    summary: str
    tokenCount: int


class ClassifyDocumentRequest(BaseModel):
    fileName: str
    projectName: str
    textContent: Optional[str] = None
    model: str = "gemini-2.0-flash-exp"
    fileData: Optional[str] = None  # base64 encoded file


class ProjectSummaryRequest(BaseModel):
    inventory: List[dict]
    projectName: str
    model: str = "gemini-2.0-flash-exp"


class DataEntryRow(BaseModel):
    Item: str
    ItemDesc: Optional[str] = None
    ItemClarification: Optional[str] = None
    Entry: Optional[str] = None
    EntryID: Optional[str] = None
    Risk: Optional[str] = None
    Comments: Optional[str] = None
    ImpliedExplicit: Optional[str] = None
    IncludeTable: Optional[bool] = False


class AnalyzeReportSectionRequest(BaseModel):
    sectionTitle: str
    subsectionTitle: str
    rows: List[DataEntryRow]
    inventory: List[dict]
    processedFiles: List[dict]
    proposalContext: str
    config: dict
    userPrompt: Optional[str] = None
    forcedFileIds: Optional[List[str]] = None
    model: str = "gemini-2.5-pro"


class RegenerateNarrativeRequest(BaseModel):
    subsectionTitle: str
    rows: List[DataEntryRow]
    config: dict
    model: str = "gemini-2.5-pro"


class GenerateConclusionRequest(BaseModel):
    sectionTitle: str
    subsectionsContent: str
    highRiskRows: List[DataEntryRow]
    model: str = "gemini-2.5-pro"


class GenerateExecutiveSummaryRequest(BaseModel):
    proposalText: str
    stage: int
    model: str = "gemini-2.5-pro"


class GenerateTableSummaryRequest(BaseModel):
    sectionTitle: str
    sectionContent: str
    model: str = "gemini-2.0-flash-exp"


class PdfAnalysisRequest(BaseModel):
    fileData: str  # base64
    model: str = "gemini-2.0-flash-exp"


# === Helper Functions ===

def get_current_user(request: Request) -> dict:
    """Extract user from JWT token"""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise NotAuthorizedException("Missing or invalid authorization header")
    
    token = auth_header.split(" ")[1]
    payload = decode_access_token(token)
    
    if not payload:
        raise NotAuthorizedException("Invalid or expired token")
    
    return payload


def calculate_cost(usage: dict, model: str) -> dict:
    """Calculate cost based on token usage"""
    costs = {
        "gemini-2.0-flash-exp": {"input": 0.075, "output": 0.30},
        "gemini-1.5-pro": {"input": 1.25, "output": 5.00},
        "gemini-2.5-pro": {"input": 1.25, "output": 5.00},
        "gemini-3-flash-preview": {"input": 0.075, "output": 0.30},
        "gemini-3-pro-preview": {"input": 1.25, "output": 5.00},
    }
    
    rates = costs.get(model, costs["gemini-2.0-flash-exp"])
    input_cost = (usage.get("prompt_token_count", 0) / 1_000_000) * rates["input"]
    output_cost = (usage.get("candidates_token_count", 0) / 1_000_000) * rates["output"]
    
    return {
        "input": round(input_cost, 6),
        "output": round(output_cost, 6),
        "total": round(input_cost + output_cost, 6)
    }


def track_usage(user: dict, endpoint: str, model: str, usage: dict, cost: dict, duration_ms: float):
    """Track usage in database and usage tracker"""
    # Track in usage tracker (for caps)
    add_user_usage(user["sub"], cost["total"])
    
    # Log to database
    db = next(get_db())
    log = UsageLog(
        user_id=user["user_id"],
        email=user["sub"],
        endpoint=endpoint,
        model=model,
        prompt_tokens=usage["prompt_token_count"],
        completion_tokens=usage["candidates_token_count"],
        total_tokens=usage["total_token_count"],
        cost=cost["total"]
    )
    db.add(log)
    db.commit()
    
    # Log to CloudWatch
    log_api_request(
        user_email=user["sub"],
        endpoint=endpoint,
        model=model,
        prompt_preview="",
        tokens=usage["total_token_count"],
        cost=cost["total"],
        duration_ms=duration_ms
    )


# === API Endpoints ===

@get("/api/gemini/models")
async def list_models(request: Request, state: State) -> dict:
    """List available Gemini models"""
    user = get_current_user(request)
    
    # Fallback list
    known_models = [
        "gemini-3-flash-preview",
        "gemini-3-pro-preview",
        "gemini-2.5-flash-preview",
        "gemini-2.5-pro",
        "gemini-2.5-pro-preview",
        "gemini-1.5-flash",
        "gemini-1.5-pro",
        "gemini-1.5-flash-8b"
    ]
    
    try:
        client = state.gemini_client
        response = client.models.list()
        
        api_models = []
        for model in response:
            if model.name and 'gemini' in model.name:
                api_models.append(model.name.replace('models/', ''))
        
        if api_models:
            return {"models": list(set(api_models + known_models))}
        return {"models": known_models}
    except Exception as e:
        log_error("model_list_error", str(e), user["sub"], {})
        return {"models": known_models}


@post("/api/gemini/analyze-pdf")
async def analyze_pdf(data: PdfAnalysisRequest, request: Request, state: State) -> dict:
    """Analyze PDF chunk - returns summary"""
    start_time = time.time()
    user = get_current_user(request)
    
    # Check usage limit
    is_allowed, current_usage, remaining = check_usage_limit(user["sub"])
    if not is_allowed:
        raise HTTPException(
            status_code=HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Usage limit exceeded. Current: ${current_usage:.2f}"
        )
    
    client = state.gemini_client
    
    try:
        response = client.models.generate_content(
            model=data.model,
            contents={
                "parts": [
                    {"inlineData": {"mimeType": "application/pdf", "data": data.fileData}},
                    {"text": "Please provide a concise summary of this PDF chunk. Identify the key topics, any important dates, and the general context of the content. Keep it under 150 words."}
                ]
            }
        )
        
        usage_dict = {
            "prompt_token_count": response.usage_metadata.prompt_token_count,
            "candidates_token_count": response.usage_metadata.candidates_token_count,
            "total_token_count": response.usage_metadata.total_token_count,
        }
        
        cost = calculate_cost(usage_dict, data.model)
        duration_ms = (time.time() - start_time) * 1000
        
        track_usage(user, "/api/gemini/analyze-pdf", data.model, usage_dict, cost, duration_ms)
        
        return {
            "summary": response.text or "Summary generation failed.",
            "usage": usage_dict,
            "cost": cost
        }
    
    except Exception as e:
        log_error("api_error", str(e), user["sub"], {"endpoint": "/api/gemini/analyze-pdf"})
        raise


@post("/api/gemini/extract-pdf-text")
async def extract_pdf_text(data: PdfAnalysisRequest, request: Request, state: State) -> dict:
    """Extract text from PDF"""
    start_time = time.time()
    user = get_current_user(request)
    
    # Check usage limit
    is_allowed, current_usage, remaining = check_usage_limit(user["sub"])
    if not is_allowed:
        raise HTTPException(
            status_code=HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Usage limit exceeded"
        )
    
    client = state.gemini_client
    
    try:
        response = client.models.generate_content(
            model=data.model,
            contents={
                "parts": [
                    {"inlineData": {"mimeType": "application/pdf", "data": data.fileData}},
                    {"text": "Extract the full text content from this document. Preserve headers and structure where possible."}
                ]
            }
        )
        
        usage_dict = {
            "prompt_token_count": response.usage_metadata.prompt_token_count,
            "candidates_token_count": response.usage_metadata.candidates_token_count,
            "total_token_count": response.usage_metadata.total_token_count,
        }
        
        cost = calculate_cost(usage_dict, data.model)
        duration_ms = (time.time() - start_time) * 1000
        
        track_usage(user, "/api/gemini/extract-pdf-text", data.model, usage_dict, cost, duration_ms)
        
        return {
            "text": response.text or "",
            "usage": usage_dict,
            "cost": cost
        }
    
    except Exception as e:
        # Handle empty documents gracefully
        if "document has no pages" in str(e) or "INVALID_ARGUMENT" in str(e):
            return {"text": "", "usage": {}, "cost": {}}
        log_error("api_error", str(e), user["sub"], {"endpoint": "/api/gemini/extract-pdf-text"})
        raise


# Note: Due to character limits, I'll create the rest of the endpoints in a follow-up
# This file establishes the pattern and includes the most critical endpoints
