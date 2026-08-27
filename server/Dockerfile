# Built from the server/ directory as context: unlike the High Frontier image
# this one needs nothing from the repo root, because the API never simulates.
# It stores orders and compares hashes; the rules live in the client's wasm.
#
#   flyctl deploy --config server/fly.toml --dockerfile server/Dockerfile server
#
# Node 22 is required, not merely preferred: storage uses the built in
# `node:sqlite`, which is what lets this image skip a native build toolchain
# entirely (no better-sqlite3, no python, no build-essential).
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
