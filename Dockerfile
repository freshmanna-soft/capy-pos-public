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
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built app from build stage
COPY --from=build /app/dist/capy-pos/browser /usr/share/nginx/html

# Expose port 8080 (Code Engine default)
EXPOSE 8080

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
