# Multi-stage: Build React frontend, serve with Litestar
FROM node:18-alpine AS frontend-builder

WORKDIR /app

# Build frontend
COPY package*.json ./
RUN npm install
COPY . .
ARG GEMINI_API_KEY
ENV GEMINI_API_KEY=$GEMINI_API_KEY
RUN npm run build && ls -la dist/ && echo "✓ Build completed, dist directory created"

# Python backend with micromamba
FROM mambaorg/micromamba:1.5.10

USER root
WORKDIR /app

# Install Python dependencies
COPY --chown=$MAMBA_USER:$MAMBA_USER backend/environment.yml ./
RUN micromamba install -y -n base -f environment.yml && \
    micromamba clean --all --yes

# Copy backend code
COPY --chown=$MAMBA_USER:$MAMBA_USER backend/ ./

# Copy built frontend from previous stage
COPY --from=frontend-builder --chown=$MAMBA_USER:$MAMBA_USER /app/dist ./dist

# Create data directory for SQLite database
RUN mkdir -p /app/data && chown $MAMBA_USER:$MAMBA_USER /app/data

USER $MAMBA_USER

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

CMD ["/usr/local/bin/_entrypoint.sh", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
