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
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir spotdl mutagen rapidfuzz pykakasi unidecode

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
