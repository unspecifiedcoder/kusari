# Backend only: the judge frontend is deployed separately on Vercel.
# Runtime secrets are injected by Fly; no .env file or credential is copied into this image.
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY reader/package.json reader/package-lock.json ./reader/
RUN npm ci --prefix reader --include=dev --ignore-scripts --no-audit --no-fund \
    && node reader/node_modules/playwright/cli.js install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm

COPY agent/package.json agent/package-lock.json ./agent/
RUN npm ci --prefix agent --omit=dev --ignore-scripts --no-audit --no-fund \
    && rm -rf /root/.npm

COPY reader/build.mjs ./reader/
COPY reader/src/ ./reader/src/
RUN cd reader && node build.mjs

COPY agent/src/ ./agent/src/
COPY proxy/server.mjs ./proxy/server.mjs
COPY shared/types.ts shared/owner-policy-message.mjs ./shared/
COPY config/chains.json ./config/chains.json
COPY deployments/*.json ./deployments/
COPY scripts/demo-gateway.mjs scripts/start-hosted-demo.mjs scripts/present-hosted-demo.mjs scripts/sandbox-access.mjs scripts/api-trade.mjs scripts/owner-policy-check.mjs ./scripts/

USER node
EXPOSE 8788
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["node", "scripts/start-hosted-demo.mjs"]
