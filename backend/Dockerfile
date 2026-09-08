# ==================================================================
# FUELWISE API — FastAPI + XGBoost (Phase 2).
# ==================================================================
FROM python:3.12-slim

# Keeps Python from writing .pyc files & buffers stdout for logs.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies first for better layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code.
COPY app ./app
COPY scripts ./scripts

# Model artifacts live here (trained on host, mounted via compose volume).
RUN mkdir -p /app/models

# Non-root user for safety.
RUN adduser --disabled-password --gecos "" appuser \
    && chown -R appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
