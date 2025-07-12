# Production stage - MCP Backend Only
FROM node:18-slim

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --gid 1001 nodejs

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code (only backend files needed)
COPY src ./src

# Set environment variables
ENV NODE_ENV=production
ENV EXPRESS_SERVER_URL=http://localhost:3000
ENV ENABLE_CANVAS_SYNC=true

# Switch to non-root user
USER nodejs

# Run MCP server only
CMD ["npm", "start"] 