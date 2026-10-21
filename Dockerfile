# Stage 1: Build native dependencies from source for older CPU compatibility
FROM node:24-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    pkg-config \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

ENV SHARP_FORCE_GLOBAL_LIBVIPS=1

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
RUN npm rebuild sharp argon2 --build-from-source

# Stage 2: Build frontend assets, Tailwind CSS, vendor assets & template PUBLIC_ORIGIN
FROM node:24-bookworm-slim AS build
WORKDIR /app
ARG PUBLIC_ORIGIN

COPY package.json package-lock.json tailwind.config.js ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY public ./public
COPY scripts/build-assets.js ./scripts/build-assets.js

RUN npm run build:css
RUN node scripts/build-assets.js

# Stage 3: Production node_modules with native build
FROM node:24-bookworm-slim AS prod-deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    pkg-config \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

ENV SHARP_FORCE_GLOBAL_LIBVIPS=1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
RUN npm rebuild sharp argon2 --build-from-source

# Stage 4: Minimal, hardened production runtime
FROM node:24-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips42 \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV TZ=Asia/Kolkata

COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/public ./public
COPY --chown=node:node server ./server
COPY --chown=node:node package.json ./

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "--max-old-space-size=384", "server/index.js"]
