# ── Stage 1: install production deps ──────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

# ── Stage 2: runtime image ─────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Copy deps and source
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

ENV NODE_ENV=production

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${RUNNER_PORT:-8787}/healthz || exit 1

EXPOSE 8787

CMD ["node", "src/server.mjs"]
