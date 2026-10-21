FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install --no-audit --no-fund && npm run build && npm prune --omit=dev && mkdir -p /app/data && chown -R node:node /app
COPY scripts ./scripts
COPY public ./public
USER node
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
EXPOSE 3000
CMD ["node","scripts/semrush-server.mjs"]
