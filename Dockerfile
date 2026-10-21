# Stage: Lightweight production runner
FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy package metadata
COPY package.json ./

# Copy compiled engine, runner scripts, and web assets
COPY dist ./dist
COPY scripts ./scripts
COPY public ./public

# Expose web application port
EXPOSE 3000

# Start Open Semrush HTTP & API Server
CMD ["node", "scripts/semrush-server.mjs"]
