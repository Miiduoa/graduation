FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential && \
    rm -rf /var/lib/apt/lists/*

# Install the exact hashed cloud lock (requirements-cloud.txt). Public bind is
# intentional for container platforms under the existing Firebase auth contract
# (see render.yaml REQUIRE_FIREBASE_AUTH=true). Local `python server.py` defaults
# to loopback — do not weaken that path.
COPY requirements-cloud.txt ./requirements-cloud.txt
RUN pip install --no-cache-dir --require-hashes -r requirements-cloud.txt

COPY . .

ENV AI_SERVER_HOST=0.0.0.0

RUN mkdir -p data/chroma_db data/training data/feedback data/lora_adapters data/self_training

EXPOSE 8100

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8100"]
