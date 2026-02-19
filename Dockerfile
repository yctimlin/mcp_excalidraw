# Dockerfile for MCP Excalidraw Server
# Builds the MCP server with SQLite persistence

# Stage 1: Build backend (TypeScript compilation + native modules)
FROM node:18-slim AS builder

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY src ./src
COPY tsconfig.json ./
RUN npm run build:server

# Stage 2: Production MCP Server
FROM node:18-slim AS production

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --gid 1001 nodejs

WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# Remove build tools after native modules are compiled
RUN apt-get purge -y python3 make g++ && apt-get autoremove -y

COPY --from=builder /app/dist ./dist

RUN chown -R nodejs:nodejs /app
USER nodejs

ENV NODE_ENV=production
ENV EXPRESS_SERVER_URL=http://localhost:3000
ENV ENABLE_CANVAS_SYNC=true

CMD ["node", "dist/index.js"]

LABEL org.opencontainers.image.source="https://github.com/sanjibdevnathlabs/mcp-excalidraw-local"
LABEL org.opencontainers.image.description="MCP Excalidraw Server - Model Context Protocol for AI agents (with SQLite persistence & multi-tenancy)"
LABEL org.opencontainers.image.licenses="MIT"
