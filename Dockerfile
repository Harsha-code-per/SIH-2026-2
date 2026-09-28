# WellTwin: one image, UI + API on :8765
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY engine/ engine/
COPY data/*.csv data/
COPY --from=web /web/dist web/dist
ENV PYTHONUNBUFFERED=1 WELLTWIN_DB=/state/audit.db
EXPOSE 8765
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8765/api/field')"
CMD ["uvicorn", "engine.api:app", "--host", "0.0.0.0", "--port", "8765"]
