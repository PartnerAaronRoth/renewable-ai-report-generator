from litestar import Litestar, post, get, Request
from litestar.connection import ASGIConnection
from litestar.exceptions import NotAuthorizedException
from litestar.middleware import DefineMiddleware
from litestar.datastructures import State
from litestar.response import File
from pydantic import BaseModel, EmailStr
from typing import Optional
from pathlib import Path
import os
import yaml
import time

from database import init_db, get_db, User, UsageLog
from auth import (
    hash_password, verify_password, create_access_token, 
    decode_access_token, create_reset_token
)
from email_service import send_password_reset_email
from logging_config import log_auth_event, log_api_request, log_error, log_document_processed
from datetime import datetime, timedelta

from google import genai
from google.genai import types


# Load authorized emails
with open("config.yml", "r") as f:
    config = yaml.safe_load(f)
    AUTHORIZED_EMAILS = config["authorized_emails"]


# Pydantic models
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str


class GeminiRequest(BaseModel):
    prompt: str
    model: str = "gemini-2.0-flash-exp"
    temperature: float = 0.7


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MessageResponse(BaseModel):
    message: str


class GeminiResponse(BaseModel):
    content: str
    usage: dict
    cost: dict


def get_current_user(connection: ASGIConnection) -> dict:
    """Extract user from JWT token"""
    auth_header = connection.headers.get("Authorization")
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
    }
    
    rates = costs.get(model, costs["gemini-2.0-flash-exp"])
    input_cost = (usage.get("prompt_token_count", 0) / 1_000_000) * rates["input"]
    output_cost = (usage.get("candidates_token_count", 0) / 1_000_000) * rates["output"]
    
    return {
        "input": round(input_cost, 6),
        "output": round(output_cost, 6),
        "total": round(input_cost + output_cost, 6)
    }


# Auth endpoints
@post("/auth/register")
async def register(data: RegisterRequest, state: State) -> AuthResponse:
    """Register new user (email must be in authorized list)"""
    if data.email not in AUTHORIZED_EMAILS:
        log_auth_event("register", data.email, False, "Email not in authorized list")
        raise NotAuthorizedException("Email not authorized")
    
    db = next(get_db())
    
    # Check if user exists
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        log_auth_event("register", data.email, False, "User already exists")
        raise NotAuthorizedException("User already exists")
    
    # Create user
    user = User(
        email=data.email,
        hashed_password=hash_password(data.password)
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    log_auth_event("register", data.email, True, "User registered successfully")
    
    token = create_access_token(user.email, user.id)
    return AuthResponse(access_token=token)


@post("/auth/login")
async def login(data: LoginRequest) -> AuthResponse:
    """Login user"""
    db = next(get_db())
    
    user = db.query(User).filter(User.email == data.email).first()
    if not user or not verify_password(data.password, user.hashed_password):
        log_auth_event("login", data.email, False, "Invalid credentials")
        raise NotAuthorizedException("Invalid credentials")
    
    if not user.is_active:
        log_auth_event("login", data.email, False, "Account disabled")
        raise NotAuthorizedException("Account disabled")
    
    log_auth_event("login", data.email, True, "Login successful")
    
    token = create_access_token(user.email, user.id)
    return AuthResponse(access_token=token)


@post("/auth/password-reset-request")
async def password_reset_request(data: PasswordResetRequest) -> MessageResponse:
    """Request password reset"""
    db = next(get_db())
    
    user = db.query(User).filter(User.email == data.email).first()
    if not user:
        # Don't reveal if user exists
        return MessageResponse(message="If email exists, reset link sent")
    
    # Generate reset token
    reset_token = create_reset_token()
    user.reset_token = reset_token
    user.reset_token_expires = datetime.utcnow() + timedelta(hours=1)
    db.commit()
    
    # Send email
    send_password_reset_email(user.email, reset_token)
    
    return MessageResponse(message="If email exists, reset link sent")


@post("/auth/password-reset-confirm")
async def password_reset_confirm(data: PasswordResetConfirm) -> MessageResponse:
    """Confirm password reset with token"""
    db = next(get_db())
    
    user = db.query(User).filter(User.reset_token == data.token).first()
    if not user or not user.reset_token_expires:
        raise NotAuthorizedException("Invalid or expired reset token")
    
    if datetime.utcnow() > user.reset_token_expires:
        raise NotAuthorizedException("Reset token expired")
    
    # Update password
    user.hashed_password = hash_password(data.new_password)
    user.reset_token = None
    user.reset_token_expires = None
    db.commit()
    
    return MessageResponse(message="Password reset successful")


@get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint"""
    return {"status": "healthy"}


@get("/api/me")
async def get_me(request: Request) -> dict:
    """Get current user info"""
    user = get_current_user(request)
    return {"email": user["sub"], "user_id": user["user_id"]}


@post("/api/gemini/classify")
async def classify_document(data: GeminiRequest, request: Request, state: State) -> GeminiResponse:
    """Classify documents using Gemini (requires auth)"""
    start_time = time.time()
    user = get_current_user(request)
    client = state.gemini_client
    
    try:
        response = client.models.generate_content(
            model=data.model,
            contents=data.prompt,
            config=types.GenerateContentConfig(temperature=data.temperature)
        )
        
        usage = {
            "prompt_token_count": response.usage_metadata.prompt_token_count,
            "candidates_token_count": response.usage_metadata.candidates_token_count,
            "total_token_count": response.usage_metadata.total_token_count,
        }
        
        cost = calculate_cost(usage, data.model)
        duration_ms = (time.time() - start_time) * 1000
        
        # Log to database
        db = next(get_db())
        log = UsageLog(
            user_id=user["user_id"],
            email=user["sub"],
            endpoint="/api/gemini/classify",
            model=data.model,
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
            endpoint="/api/gemini/classify",
            model=data.model,
            prompt_preview=data.prompt,
            tokens=usage["total_token_count"],
            cost=cost["total"],
            duration_ms=duration_ms
        )
        
        return GeminiResponse(content=response.text, usage=usage, cost=cost)
    
    except Exception as e:
        log_error("api_error", str(e), user["sub"], {
            "endpoint": "/api/gemini/classify",
            "model": data.model
        })
        raise


@post("/api/gemini/extract")
async def extract_data(data: GeminiRequest, request: Request, state: State) -> GeminiResponse:
    """Extract data (requires auth)"""
    start_time = time.time()
    user = get_current_user(request)
    client = state.gemini_client
    
    try:
        response = client.models.generate_content(
            model=data.model,
            contents=data.prompt,
            config=types.GenerateContentConfig(temperature=data.temperature)
        )
        
        usage = {
            "prompt_token_count": response.usage_metadata.prompt_token_count,
            "candidates_token_count": response.usage_metadata.candidates_token_count,
            "total_token_count": response.usage_metadata.total_token_count,
        }
        
        cost = calculate_cost(usage, data.model)
        duration_ms = (time.time() - start_time) * 1000
        
        # Log to database
        db = next(get_db())
        log = UsageLog(
            user_id=user["user_id"],
            email=user["sub"],
            endpoint="/api/gemini/extract",
            model=data.model,
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
            endpoint="/api/gemini/extract",
            model=data.model,
            prompt_preview=data.prompt,
            tokens=usage["total_token_count"],
            cost=cost["total"],
            duration_ms=duration_ms
        )
        
        return GeminiResponse(content=response.text, usage=usage, cost=cost)
    
    except Exception as e:
        log_error("api_error", str(e), user["sub"], {
            "endpoint": "/api/gemini/extract",
            "model": data.model
        })
        raise


@post("/api/gemini/generate")
async def generate_report(data: GeminiRequest, request: Request, state: State) -> GeminiResponse:
    """Generate report (requires auth)"""
    start_time = time.time()
    user = get_current_user(request)
    client = state.gemini_client
    
    try:
        response = client.models.generate_content(
            model=data.model,
            contents=data.prompt,
            config=types.GenerateContentConfig(temperature=data.temperature)
        )
        
        usage = {
            "prompt_token_count": response.usage_metadata.prompt_token_count,
            "candidates_token_count": response.usage_metadata.candidates_token_count,
            "total_token_count": response.usage_metadata.total_token_count,
        }
        
        cost = calculate_cost(usage, data.model)
        duration_ms = (time.time() - start_time) * 1000
        
        # Log to database
        db = next(get_db())
        log = UsageLog(
            user_id=user["user_id"],
            email=user["sub"],
            endpoint="/api/gemini/generate",
            model=data.model,
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
            endpoint="/api/gemini/generate",
            model=data.model,
            prompt_preview=data.prompt,
            tokens=usage["total_token_count"],
            cost=cost["total"],
            duration_ms=duration_ms
        )
        
        return GeminiResponse(content=response.text, usage=usage, cost=cost)
    
    except Exception as e:
        log_error("api_error", str(e), user["sub"], {
            "endpoint": "/api/gemini/generate",
            "model": data.model
        })
        raise


@get("/{path:path}")
async def serve_spa(path: str) -> File:
    """Serve React SPA (catch-all route for production)"""
    static_dir = Path("dist")
    
    # API routes handled above
    if path.startswith("api/") or path.startswith("auth/"):
        return None
    
    file_path = static_dir / path
    
    # If file exists, serve it
    if file_path.is_file():
        return File(file_path)
    
    # Otherwise serve index.html (for client-side routing)
    index_path = static_dir / "index.html"
    if index_path.exists():
        return File(index_path)
    
    # dist/ doesn't exist (development mode)
    return None


def on_startup(state: State) -> None:
    """Initialize on startup"""
    # Initialize database
    init_db()
    
    # Initialize Gemini client
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY required")
    
    client = genai.Client(api_key=api_key)
    state.gemini_client = client


app = Litestar(
    route_handlers=[
        health_check,
        register, login,
        password_reset_request, password_reset_confirm,
        get_me,
        classify_document, extract_data, generate_report,
        serve_spa  # Catch-all must be last
    ],
    on_startup=[on_startup],
)
