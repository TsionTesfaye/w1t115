FROM node:18-alpine

WORKDIR /app

# Install bash (required for run_tests.sh and shell scripts)
RUN apk add --no-cache bash

SHELL ["/bin/bash", "-c"]

# Install dependencies first (layer-cached until package.json changes)
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

EXPOSE 4200

# Start dev server bound to all interfaces so Docker port mapping works
CMD ["npx", "ng", "serve", "--host", "0.0.0.0"]
