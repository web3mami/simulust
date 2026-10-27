# CUDA 12.8 covers Ada (RTX 4090, L40S), Hopper (H100) and Blackwell (RTX 5090, B200).
FROM pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/models \
    LORA_DIR=/loras

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app.py models.py safety.py ./

# Model weights (~60 GB for all three models plus the tagger) download into
# /models on first use. Mount a persistent volume there.
RUN useradd --create-home --uid 1000 worker && mkdir -p /models /loras && chown worker /models /loras
USER worker

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"

# One process per GPU: the models and the job queue live in this process.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
