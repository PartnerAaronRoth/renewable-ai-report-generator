from litestar import Litestar, get
from litestar.static_files import create_static_files_router
from litestar.response import File
from pathlib import Path


@get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint"""
    return {"status": "healthy"}


# Serve index.html for all non-API routes (SPA routing)
@get("/{path:path}")
async def serve_spa(path: str) -> File:
    """Serve React SPA"""
    static_dir = Path("dist")
    file_path = static_dir / path
    
    # If file exists, serve it
    if file_path.is_file():
        return File(file_path)
    
    # Otherwise serve index.html (for client-side routing)
    return File(static_dir / "index.html")


app = Litestar(
    route_handlers=[health_check, serve_spa],
)
