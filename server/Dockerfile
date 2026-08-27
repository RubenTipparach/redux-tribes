# Built from the REPOSITORY ROOT as the Docker context, because one image now
# carries both halves of the game:
#
#   flyctl deploy --config server/fly.toml --dockerfile server/Dockerfile .
#
# The client is a static bundle of a few hundred kilobytes, so serving it from
# the same machine that brokers turns is cheaper than running a second pipeline
# for it. It also means the page and the API it talks to are always the same
# build, which a separate Pages deploy cannot promise.

# --- 1. the simulation ------------------------------------------------------
# The core is compiled to wasm here so the client stage does not need a Rust
# toolchain, and so a failure to build the model stops the image early.
FROM rust:1-slim AS sim
WORKDIR /build
RUN rustup target add wasm32-unknown-unknown
COPY engine/sim_core/Cargo.toml engine/sim_core/Cargo.lock ./engine/sim_core/
COPY engine/sim_core/src/ ./engine/sim_core/src/
RUN cd engine/sim_core && cargo build --release --target wasm32-unknown-unknown

# --- 2. the client ----------------------------------------------------------
FROM node:22-slim AS client
WORKDIR /build/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY web/tsconfig.json web/build.mjs web/index.html ./
COPY web/src/ ./src/
COPY --from=sim /build/engine/sim_core/target/wasm32-unknown-unknown/release/sim_core.wasm ./public/sim_core.wasm
# Typecheck in the image too: a client that does not compile must not ship,
# whatever CI did or did not manage to run.
RUN npx tsc --noEmit && node build.mjs

# --- 3. the server ----------------------------------------------------------
# Node 22 is required, not merely preferred: storage uses the built in
# `node:sqlite`, which is what lets this image skip a native build toolchain
# entirely (no better-sqlite3, no python, no build-essential).
FROM node:22-slim
WORKDIR /app

COPY server/package.json server/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY server/tsconfig.json ./
COPY server/src/ ./src/
RUN npm run build && npm prune --omit=dev

COPY --from=client /build/web/dist/ ./public/

ENV NODE_ENV=production
ENV PORT=8080
ENV CLIENT_DIR=/app/public
EXPOSE 8080

CMD ["node", "dist/index.js"]
