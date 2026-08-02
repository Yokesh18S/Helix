# ============================================
# Helix - AI Voice Business Consultant
# Multi-stage Dockerfile
# ============================================

# Stage 1: Build Frontend
FROM node:18-alpine AS frontend-build

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --production=false

COPY frontend/ ./
RUN npm run build


# Stage 2: Python Backend + Serve Frontend
FROM python:3.11-slim AS production

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./

# Copy built frontend into static directory
COPY --from=frontend-build /app/frontend/dist ./static

# Create uploads directory
RUN mkdir -p uploads

# Expose port
EXPOSE 7000

# Environment variables (override at runtime)
ENV GEMINI_API_KEY=""
ENV GEMINI_MODEL="gemini-2.5-flash"
ENV SECRET_KEY="helix-production-secret-change-me"
ENV DATABASE_URL="sqlite:///./helix.db"

# Start command
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7000"]
