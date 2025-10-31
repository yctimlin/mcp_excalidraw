# Dockerfile for MCP Excalidraw Server
# This builds the MCP server only (core product for CI/CD and GHCR)
# The canvas server is optional and runs separately

# Stage 1: Build backend (TypeScript compilation)
FROM node:18-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including TypeScript compiler)
RUN npm ci && npm cache clean --force

# Copy backend source
COPY src ./src
COPY tsconfig.json ./

# Compile TypeScript
RUN npm run build:server

# Stage 2: Production MCP Server
FROM node:18-slim AS production

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --gid 1001 nodejs

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy compiled backend (MCP server only)
COPY --from=builder /app/dist ./dist

# Set ownership to nodejs user
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Set environment variables with defaults
ENV NODE_ENV=production
ENV EXPRESS_SERVER_URL=http://localhost:3000
ENV ENABLE_CANVAS_SYNC=true

# Run MCP server (stdin/stdout protocol)
CMD ["node", "dist/index.js"]

# Labels for metadata
LABEL org.opencontainers.image.source="https://github.com/yctimlin/mcp_excalidraw"
LABEL org.opencontainers.image.description="MCP Excalidraw Server - Model Context Protocol for AI agents"
LABEL org.opencontainers.image.licenses="MIT"
