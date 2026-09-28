# Stage 1: Build the Angular app
FROM node:22-alpine AS build

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source code and build
COPY . .
RUN npx ng build --configuration=production

# Stage 2: Serve with nginx
# nginx:alpine tracks the latest stable Alpine release. `apk upgrade` is run
# unconditionally so that any CVE patched in the Alpine package index (e.g.
# expat CVE-2026-93990, fixed in expat-2.8.5-r0) is applied at image build
# time rather than waiting for a new upstream nginx tag.
FROM nginx:alpine

RUN apk upgrade --no-cache

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built app from build stage
COPY --from=build /app/dist/capy-pos/browser /usr/share/nginx/html

# Expose port 8080 (Code Engine default)
EXPOSE 8080

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
