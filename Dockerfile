FROM node:22-bookworm-slim
ENV NODE_ENV=production PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 PORT=7860 AHOLO_DEPLOYMENT=modelscope \
    AHOLO_DATA_DIR=/mnt/workspace/aholo-poc AHOLO_EFFECTS_ENABLED=0 \
    AHOLO_PYTHON=/opt/aholo-python/bin/python
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/aholo-python
WORKDIR /app
COPY requirements.txt ./
RUN /opt/aholo-python/bin/python -m pip install -r requirements.txt
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN node --test tests/showcase.test.mjs
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
    CMD node -e "fetch('http://127.0.0.1:7860/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "structure_server.mjs", "--studio"]
