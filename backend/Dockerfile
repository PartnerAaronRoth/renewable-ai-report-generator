FROM mambaorg/micromamba:1.5.10

USER root
WORKDIR /app

# Copy environment file
COPY --chown=$MAMBA_USER:$MAMBA_USER backend/environment.yml ./

# Install dependencies with micromamba
RUN micromamba install -y -n base -f environment.yml && \
    micromamba clean --all --yes

# Copy application
COPY --chown=$MAMBA_USER:$MAMBA_USER backend/ ./

# Switch to non-root user
USER $MAMBA_USER

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

# Run with micromamba
CMD ["/usr/local/bin/_entrypoint.sh", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
