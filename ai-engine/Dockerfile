FROM python:3.11-slim AS production

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN groupadd --system trivikrama \
    && useradd --system --gid trivikrama --no-create-home trivikrama

COPY requirements.txt ./
RUN python -m pip install --requirement requirements.txt

COPY app ./app
COPY models ./models

USER trivikrama
EXPOSE 8000

# This verifies process reachability. Model readiness is represented by the
# response body's status/model_loaded fields and is consumed by the backend.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=2)" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
