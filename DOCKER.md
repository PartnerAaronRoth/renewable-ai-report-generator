# Docker Setup

## Current Architecture

**Production:** Litestar (Python) serves built React app on port 8000
**Development:** Vite dev server (3000) + Litestar backend (8000)

---

## Quick Start

### Development Mode

```bash
# 1. Create environment file
cp env.example .env.local
# Edit .env.local and add your GEMINI_API_KEY

# 2. Start
docker-compose -f docker-compose.dev.yml up --build
```

Frontend: http://localhost:3000
Backend: http://localhost:8000/health

### Production Mode

```bash
export GEMINI_API_KEY=your_key_here
docker-compose up --build -d
```

App: http://localhost:8000

View logs: `docker-compose logs -f`
Stop: `docker-compose down`

---

## Files

- `Dockerfile` - Production (builds React, serves with Litestar)
- `docker-compose.yml` - Production orchestration
- `docker-compose.dev.yml` - Development orchestration
- `backend/Dockerfile` - Litestar backend
- `backend/Dockerfile.dev` - Litestar dev with hot reload

---

## Architecture

### Production
```
Browser → Litestar (port 8000)
          ├─ Serves static React files
          └─ /health endpoint
```

### Development
```
Browser → Vite (port 3000) - Frontend with hot reload
          Litestar (port 8000) - Backend (/health only for now)
```

---

## Container Details

**Production:**
- Multi-stage build (Node builds React → Python serves)
- Base: `mambaorg/micromamba:1.5.10` (Python 3.11)
- Port: 8000
- Non-root user
- Health check enabled

**Development:**
- Separate containers for frontend/backend
- Source mounted as volumes (hot reload)
- Frontend: port 3000
- Backend: port 8000

---

## Troubleshooting

**Container won't start:**
```bash
docker-compose logs
```

**Port in use:**
```bash
lsof -i :8000
# Kill process or change port in docker-compose.yml
```

**Clean rebuild:**
```bash
docker-compose down --volumes
docker system prune -a
docker-compose up --build
```

---

## Deployment

### AWS ECR/ECS
```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com
docker build -t renewable-ai:latest --build-arg GEMINI_API_KEY=$KEY .
docker tag renewable-ai:latest <account>.dkr.ecr.us-east-1.amazonaws.com/renewable-ai:latest
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/renewable-ai:latest
```

### Google Cloud Run
```bash
gcloud builds submit --tag gcr.io/PROJECT-ID/renewable-ai
gcloud run deploy --image gcr.io/PROJECT-ID/renewable-ai --platform managed
```

---

## Current State

- Frontend calls Gemini API directly (client-side)
- Backend only has `/health` endpoint
- No authentication yet
- No cost tracking yet
