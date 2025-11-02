# --- STAGE 1: Builder ---
FROM node:20-slim AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# --- STAGE 2: Production ---
FROM node:20-slim
WORKDIR /usr/src/app

RUN apt-get update && apt-get install -y \
    ca-certificates \
    --no-install-recommends \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --production
COPY --from=builder /usr/src/app/dist ./dist

RUN addgroup --system nonroot && adduser --system --group nonroot
USER nonroot
EXPOSE 3000
CMD [ "node", "dist/main" ]
