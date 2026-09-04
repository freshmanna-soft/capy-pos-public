# Capy-POS products/transactions/health API, on IBM Cloud Code Engine.
#
# Built and pushed by hand (or by a pipeline) to the registry namespace
# `terraform/main.tf` pulls from:
#
#   ibmcloud cr login
#   docker build -f infra/pos-api/Dockerfile -t us.icr.io/$CR_NAMESPACE/capy-pos-api:v1 infra
#   docker push us.icr.io/$CR_NAMESPACE/capy-pos-api:v1
#
# The build context is `infra/`, not `infra/pos-api` — unlike the sibling
# services. `tsconfig.json`'s own `rootDir` comment already says why: `api.ts`
# and `server.ts` import the DocumentStore port from `infra/shared/` (story
# #204), and Docker can never `COPY` a path from outside its context — that's
# a hard restriction, not something a cleverer Dockerfile line works around.
# This was documented in tsconfig.json's own comment ("there is no Dockerfile
# here yet to break") well before it was actually implemented; the currently
# live image predates story #204's refactor entirely, which is exactly why
# this went unnoticed until the next real rebuild.
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
# `shared` has none of its own (see infra/shared/package.json) — nothing to
# install for it, only source to copy.
COPY pos-api/package.json pos-api/package-lock.json ./pos-api/
RUN cd pos-api && npm ci --ignore-scripts

COPY pos-api/tsconfig.json ./pos-api/tsconfig.json
COPY pos-api/src ./pos-api/src
# `package.json` too, not just `src` — its `"type": "module"` is what makes tsc
# treat `document-store.ts` as ESM. Without it, Node's default (CommonJS) module
# type applies, and `verbatimModuleSyntax` then rejects the file's own `export`
# syntax as invalid for a CommonJS module (TS1287) — confirmed by hitting exactly
# that error with only `shared/src` copied in.
COPY shared/package.json ./shared/package.json
COPY shared/src ./shared/src
# tsconfig.json's `rootDir: ".."` (relative to itself, i.e. this `/app`) is what
# makes tsc accept `../../shared/src/document-store.ts` as an input file at all
# (TS6059 otherwise) — and what makes it mirror the tree from `/app` down, so
# emit lands at `pos-api/dist/pos-api/src/server.js` and
# `pos-api/dist/shared/src/document-store.js`, not a flat `dist/server.js` the
# way the sibling services' emit does.
RUN cd pos-api && npm run build

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Code Engine sets NODE_ENV itself (`service_env` in main.tf), but a container that
# is correct when run by hand is worth more than one that depends on its scheduler.
ENV NODE_ENV=production

WORKDIR /app

# Production dependencies only. pos-api has none today (Cloudant is called over
# plain HTTPS, not an SDK) — this still validates the lockfile and stays correct
# the day a real runtime dependency is added.
COPY pos-api/package.json pos-api/package-lock.json ./pos-api/
RUN cd pos-api && npm ci --omit=dev --ignore-scripts && npm cache clean --force

# The mirrored-tree emit means this is `./dist/pos-api/src/server.js` and
# `./dist/shared/src/document-store.js` here, not a flat `./dist/server.js`.
COPY --from=build /app/pos-api/dist ./dist

# The `node` user ships with the image. Root is not needed to bind 8790 — it is
# above 1024 — so nothing here has to run as it.
USER node

EXPOSE 8790

# No HEALTHCHECK: Code Engine probes the port itself (`image_port`). GET /api/health
# is unauthenticated, unlike the two proxies, but a second probe mechanism buys
# nothing Code Engine's own doesn't already cover.
CMD ["node", "dist/pos-api/src/server.js"]
