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

# Default: run the full test suite (build gate + vitest).
# To run the dev server instead:
#   docker run --rm -p 4200:4200 <image> npx ng serve --host 0.0.0.0
CMD ["bash", "run_tests.sh"]
