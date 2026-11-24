# syntax=docker/dockerfile:1.10
# One image for the web service and the worker of «منصة المحكمة الرقمية» (contract §12).
#
# Base: the official Node 22 image on Debian bookworm, pinned by digest. Not the
# -slim variant: the Prisma schema engine (migrate deploy, in the release step)
# needs OpenSSL 3, which -slim does not ship (docs/decisions.md).
ARG BASE_IMAGE=node:22-bookworm@sha256:e13726ca604184d7a91fcacab1fc09eefd642dc28e79ac34e85540dd93b78cfb

FROM ${BASE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Demo routes and tools are compiled only into a demo image.
ARG DEMO_BUILD=false
COPY package.json package-lock.json .npmrc ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
# The optional build secret "npm_ca" lets a local build behind a TLS-inspecting
# proxy trust that proxy; Railway builds do not use it. Nothing secret enters a layer.
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --no-audit --no-fund
COPY . .
RUN DEMO_BUILD=${DEMO_BUILD} npm run build -w @mahkama/web \
 && rm -rf apps/web/.next/cache \
 && npm prune --omit=dev --no-audit --no-fund

FROM ${BASE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
WORKDIR /app
COPY --from=build /app/package.json /app/.npmrc ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core ./packages/core
COPY --from=build /app/apps/web/package.json /app/apps/web/next.config.ts /app/apps/web/prisma.config.ts ./apps/web/
COPY --from=build /app/apps/web/prisma ./apps/web/prisma
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/dist-server ./apps/web/dist-server
# Files are owned by root and read-only for the process, which runs unprivileged.
USER node
WORKDIR /app/apps/web
EXPOSE 3000
# Web by default; the worker runs `node dist-server/worker.mjs`, the release step
# `node dist-server/release.mjs`.
CMD ["node", "../../node_modules/next/dist/bin/next", "start"]
