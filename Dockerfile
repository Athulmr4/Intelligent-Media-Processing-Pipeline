FROM node:20-slim

# Install system dependencies for sharp and tesseract
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies required for tsc)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npx tsc

# Clean up devDependencies to keep the image size small
RUN npm prune --omit=dev && npm cache clean --force

# Create required directories
RUN mkdir -p uploads data logs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "dist/app.js"]
