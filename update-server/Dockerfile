FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .
COPY data/version.json /app/data/version.json

EXPOSE 32999

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "32999"]
