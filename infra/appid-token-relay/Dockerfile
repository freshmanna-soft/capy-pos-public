# Capy-POS App ID token relay — holds the client secret App ID's token endpoint
# requires, so it never has to live in the browser bundle, on IBM Cloud Code Engine.
#
# Built and pushed by hand (or by a pipeline) to the registry namespace
# `terraform/main.tf` pulls from:
#
#   ibmcloud cr login
#   docker build -t us.icr.io/$CR_NAMESPACE/capy-appid-token-relay:v1 infra/appid-token-relay
#   docker push us.icr.io/$CR_NAMESPACE/capy-appid-token-relay:v1
#
# Terraform references the image, it does not build it — same convention as
# every other `infra/*` service in this repo.

# ── Build ─────────────────────────────────────────────────────────────────────
# `npm run build` (tsc), not `--experimental-strip-types`: the deployed path
# should not depend on an experimental flag's behaviour under a Node patch, and
# tsc is already the typecheck gate.
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Code Engine sets NODE_ENV itself (`service_env` in main.tf), but a container
# that is correct when run by hand is worth more than one that depends on its
# scheduler.
ENV NODE_ENV=production

WORKDIR /app

# This service has zero runtime dependencies (see package.json) — `npm ci
# --omit=dev` here is really "skip typescript/@types/node," not "trim a
# model SDK," but keeping the same two-stage shape as the sibling services means
# a future dependency doesn't require restructuring this file.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist

# The `node` user ships with the image. Root is not needed to bind 8792 — it is
# above 1024 — so nothing here has to run as it.
USER node

EXPOSE 8792

# No HEALTHCHECK: Code Engine probes the port itself (`image_port`). Unlike the
# sibling proxies, every route here is deliberately unauthenticated — that is
# this service's whole purpose — so an unauthenticated healthcheck would not be
# a special case, but it would still be one more shape of traffic to reason
# about for no real benefit over the platform's own probe.
CMD ["node", "dist/server.js"]
