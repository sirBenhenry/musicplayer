FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libfftw3-dev \
    libavcodec-dev \
    libavformat-dev \
    libavutil-dev \
    libswresample-dev \
    libsamplerate0-dev \
    libsndfile1-dev \
    libtagc0-dev \
    libyaml-dev \
    ffmpeg \
    build-essential \
    libchromaprint-tools \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir spotdl mutagen rapidfuzz pykakasi unidecode

# Download EffnetDiscogs ONNX model + mood classification heads (~19 MB total)
RUN mkdir -p /app/models && \
    curl -fsSL -o /app/models/discogs_multi_embeddings.onnx \
      https://essentia.upf.edu/models/feature-extractors/discogs-effnet/discogs_multi_embeddings-effnet-bs64-1.onnx && \
    curl -fsSL -o /app/models/mood_happy-discogs-effnet-1.onnx \
      https://essentia.upf.edu/models/classification-heads/mood_happy/mood_happy-discogs-effnet-1.onnx && \
    curl -fsSL -o /app/models/mood_sad-discogs-effnet-1.onnx \
      https://essentia.upf.edu/models/classification-heads/mood_sad/mood_sad-discogs-effnet-1.onnx && \
    curl -fsSL -o /app/models/mood_aggressive-discogs-effnet-1.onnx \
      https://essentia.upf.edu/models/classification-heads/mood_aggressive/mood_aggressive-discogs-effnet-1.onnx && \
    curl -fsSL -o /app/models/mood_relaxed-discogs-effnet-1.onnx \
      https://essentia.upf.edu/models/classification-heads/mood_relaxed/mood_relaxed-discogs-effnet-1.onnx && \
    curl -fsSL -o /app/models/mood_party-discogs-effnet-1.onnx \
      https://essentia.upf.edu/models/classification-heads/mood_party/mood_party-discogs-effnet-1.onnx

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
