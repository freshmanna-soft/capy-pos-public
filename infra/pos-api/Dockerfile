# Capy-POS products/transactions/health API, on IBM Cloud Code Engine.
#
# Built and pushed by hand (or by a pipeline) to the registry namespace
# `terraform/main.tf` pulls from:
#
#   ibmcloud cr login
#   docker build -t us.icr.io/$CR_NAMESPACE/capy-pos-api:v1 infra/pos-api
#   docker push us.icr.io/$CR_NAMESPACE/capy-pos-api:v1
#
# Terraform references the image, it does not build it: `image_reference` in
# `ibm_code_engine_app.apps` is `us.icr.io/${var.cr_namespace}/capy-pos-api:${var.image_tag}`,
# so the tag pushed here and `var.image_tag` have to agree or the revision pulls
# an image that is not the one just built.

# ── Build ─────────────────────────────────────────────────────────────────────
# `npm run build` (tsc) rather than shipping the sources and running them under
# `--experimental-strip-types` the way `npm start` does locally. The deployed path
# should not depend on an experimental flag whose behaviour can change under a
# patch release of Node, and tsc is already the typecheck gate, so the image is
# built from code that has been type-checked by construction.
FROM node:22-alpine AS build

WORKDIR /app

# Dependencies first, so a source-only change does not re-resolve the tree.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Code Engine sets NODE_ENV itself (`service_env` in main.tf), but a container that
# is correct when run by hand is worth more than one that depends on its scheduler.
ENV NODE_ENV=production

WORKDIR /app

# Production dependencies only. pos-api has none today (Cloudant is called over
# plain HTTPS, not an SDK) — this still validates the lockfile and stays correct
# the day a real runtime dependency is added.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist

# The `node` user ships with the image. Root is not needed to bind 8790 — it is
# above 1024 — so nothing here has to run as it.
USER node

EXPOSE 8790

# No HEALTHCHECK: Code Engine probes the port itself (`image_port`). GET /api/health
# is unauthenticated, unlike the two proxies, but a second probe mechanism buys
# nothing Code Engine's own doesn't already cover.
CMD ["node", "dist/server.js"]
