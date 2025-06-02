FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    build-essential \
    libatlas-base-dev \
    libxml2-dev \
    libxslt1-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.lock .

RUN python -m venv /venv
ENV PATH="/venv/bin:$PATH"

RUN pip install --upgrade pip && pip install -r requirements.lock

COPY . .

EXPOSE 5000
ENV TF_USE_LEGACY_KERAS=0
CMD ["python", "app.py"]