# Dockerfile for MCP Excalidraw Server
# This builds the MCP server only (core product for CI/CD and GHCR)
# The canvas server is optional and runs separately

# Stage 1: Build backend (TypeScript compilation)
FROM node:20-alpine AS builder

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
FROM node:20-alpine AS production

# Create non-root user for security, with a real home directory so npm can
# install as this user and any runtime homedir() writes have a writable target.
RUN addgroup -S -g 1001 nodejs && \
    adduser -S -u 1001 -G nodejs -h /home/nodejs nodejs && \
    mkdir -p /home/nodejs && chown nodejs:nodejs /home/nodejs
ENV HOME=/home/nodejs

WORKDIR /app

# Own the workdir up front so dependencies install as the non-root user.
# This avoids a costly `chown -R` layer that would duplicate node_modules.
RUN chown nodejs:nodejs /app
USER nodejs

# Copy package files
COPY --chown=nodejs:nodejs package*.json ./

# Install only production dependencies.
# The frontend libs (react, mermaid, @excalidraw/*) are devDependencies —
# the MCP stdio server never imports them at runtime.
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled backend (MCP server only)
COPY --chown=nodejs:nodejs --from=builder /app/dist ./dist

# Set environment variables with defaults
ENV NODE_ENV=production
ENV EXPRESS_SERVER_URL=http://127.0.0.1:3000
ENV ENABLE_CANVAS_SYNC=true
# This image has no frontend build — auto-starting a canvas here would serve
# a blank UI. The canvas runs as its own service (see docker-compose.yml).
ENV EXCALIDRAW_NO_AUTOSTART=1

# Run MCP server (stdin/stdout protocol)
CMD ["node", "dist/index.js"]

# Labels for metadata
LABEL org.opencontainers.image.source="https://github.com/yctimlin/mcp_excalidraw"
LABEL org.opencontainers.image.description="MCP Excalidraw Server - Model Context Protocol for AI agents"
LABEL org.opencontainers.image.licenses="MIT"
