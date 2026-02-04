import logging
import json
from datetime import datetime
from typing import Any, Dict

# Configure logging for CloudWatch-friendly JSON output
logging.basicConfig(
    level=logging.INFO,
    format='%(message)s',  # Just the message, we'll format as JSON
)

logger = logging.getLogger(__name__)


def log_event(event_type: str, data: Dict[str, Any]):
    """Log structured event that CloudWatch can parse"""
    log_entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "event_type": event_type,
        **data
    }
    logger.info(json.dumps(log_entry))


def log_auth_event(event: str, email: str, success: bool, details: str = ""):
    """Log authentication events"""
    log_event("auth", {
        "event": event,
        "email": email,
        "success": success,
        "details": details
    })


def log_api_request(
    user_email: str,
    endpoint: str,
    model: str,
    prompt_preview: str,
    tokens: int,
    cost: float,
    duration_ms: float
):
    """Log API request details"""
    log_event("api_request", {
        "user_email": user_email,
        "endpoint": endpoint,
        "model": model,
        "prompt_preview": prompt_preview[:200],  # First 200 chars
        "tokens": tokens,
        "cost_usd": cost,
        "duration_ms": duration_ms
    })


def log_error(error_type: str, message: str, user_email: str = None, details: Dict = None):
    """Log errors"""
    log_event("error", {
        "error_type": error_type,
        "message": message,
        "user_email": user_email,
        **(details or {})
    })


def log_document_processed(
    user_email: str,
    doc_type: str,
    doc_name: str,
    operation: str,
    result: str
):
    """Log document processing"""
    log_event("document_processed", {
        "user_email": user_email,
        "doc_type": doc_type,
        "doc_name": doc_name,
        "operation": operation,
        "result": result
    })
