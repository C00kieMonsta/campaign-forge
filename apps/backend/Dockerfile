# Multi-stage build for optimized backend container with improved layer caching
# Based on proven pattern: separate layers per package for better cache invalidation

# Stage 1: Base - Install system dependencies and pnpm, copy all manifests
FROM node:20-slim AS base

# Install OpenSSL for Prisma and poppler-utils for PDF processing
RUN apt-get update -y && apt-get install -y --no-install-recommends \
    openssl \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /usr/src/app

# Copy ALL workspace manifests and configs (for efficient layer caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.json tsconfig.packages.base.json ./

# Copy backend manifests and configs
COPY apps/backend/package.json ./apps/backend/
COPY apps/backend/tsconfig.json ./apps/backend/
COPY apps/backend/prisma ./apps/backend/prisma

# Copy packages manifests and configs
COPY packages/utils/package.json ./packages/utils/
COPY packages/utils/tsconfig.build.json ./packages/utils/
COPY packages/types/package.json ./packages/types/
COPY packages/types/tsconfig.build.json ./packages/types/

# Configure pnpm to hoist dependencies (needed for runtime module resolution)
RUN echo "shamefully-hoist=true" > .npmrc

# Install all dependencies (workspace-aware)
RUN pnpm install --frozen-lockfile

# Stage 2: Build types package (base dependency for other packages)
FROM base AS types-build

# Copy types source code and tsconfig.json (needed by tsconfig.build.json)
COPY packages/types/src ./packages/types/src
COPY packages/types/tsconfig.json ./packages/types/tsconfig.json

# Build types package
RUN pnpm --filter @packages/types build

# Stage 3: Build utils package (depends on types)
FROM base AS utils-build

# Copy types dist and source from previous build stage
COPY --from=types-build /usr/src/app/packages/types/dist ./packages/types/dist
COPY --from=types-build /usr/src/app/packages/types/src ./packages/types/src
COPY --from=types-build /usr/src/app/packages/types/tsconfig.json ./packages/types/tsconfig.json

# Copy utils source code and tsconfig.json (needed by tsconfig.build.json)
COPY packages/utils/src ./packages/utils/src
COPY packages/utils/tsconfig.json ./packages/utils/tsconfig.json

# Build utils package
RUN pnpm --filter @packages/utils build

# Stage 4: Build backend (depends on utils and types)
FROM base AS backend-build

# Copy types and utils (dist for runtime, src for TypeScript path resolution)
COPY --from=types-build /usr/src/app/packages/types/dist ./packages/types/dist
COPY --from=types-build /usr/src/app/packages/types/src ./packages/types/src
COPY --from=types-build /usr/src/app/packages/types/tsconfig.json ./packages/types/tsconfig.json
COPY --from=utils-build /usr/src/app/packages/utils/dist ./packages/utils/dist
COPY --from=utils-build /usr/src/app/packages/utils/src ./packages/utils/src
COPY --from=utils-build /usr/src/app/packages/utils/tsconfig.json ./packages/utils/tsconfig.json

# Copy backend source code, build tsconfig, and nest-cli config
COPY apps/backend/src ./apps/backend/src
COPY apps/backend/tsconfig.build.json ./apps/backend/tsconfig.build.json
COPY apps/backend/nest-cli.json ./apps/backend/nest-cli.json

# Generate Prisma client and build backend
# Use webpack compiler which is more lenient with TypeScript path resolution
# IMPORTANT: NestJS builds to dist/ relative to apps/backend directory
# Output structure: apps/backend/dist/main.js (NOT apps/backend/dist/apps/backend/src/main.js)
RUN cd apps/backend && \
    pnpm db:generate && \
    (test -d ../../packages/types/dist && echo "Types already built, skipping..." || pnpm --filter @packages/types build) && \
    (test -d ../../packages/utils/dist && echo "Utils already built, skipping..." || pnpm --filter @packages/utils build) && \
    npx nest build --webpack --tsc -p tsconfig.build.json && \
    test -d dist && echo "Build successful" || (echo "Build failed - dist directory not found" && exit 1) && \
    (test -f dist/main.js && echo "✓ main.js found at dist/main.js" || \
     (test -f dist/src/main.js && echo "✓ main.js found at dist/src/main.js (using this path)" || \
      (echo "✗ ERROR: main.js not found in dist/ or dist/src/" && find dist -name "main.js" && ls -la dist/ && exit 1)))

# Stage 5: Prune dependencies for production (remove dev dependencies)
FROM backend-build AS pruned

# Configure pnpm to hoist dependencies (flat node_modules structure)
# This ensures Node.js can resolve modules like @nestjs/core directly
RUN echo "shamefully-hoist=true" > .npmrc && \
    pnpm prune --prod && \
    pnpm install --prod --frozen-lockfile

# Stage 6: Production image - Minimal runtime
FROM node:20-slim AS production

# Install runtime dependencies only (OpenSSL for Prisma, poppler-utils for PDF, curl for health checks)
RUN apt-get update -y && apt-get install -y --no-install-recommends \
    openssl \
    poppler-utils \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm for production
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /usr/src/app

# Set environment
ENV NODE_ENV=production
ENV PORT=80

# Copy package files for reference
COPY package.json pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/backend/prisma ./apps/backend/prisma
COPY apps/backend/docker-entrypoint.sh ./apps/backend/docker-entrypoint.sh

# Copy Tesseract trained data for OCR (avoids runtime download)
COPY apps/backend/eng.traineddata ./apps/backend/eng.traineddata

# Copy tsconfig files for tsconfig-paths runtime path resolution
COPY apps/backend/tsconfig.json ./apps/backend/tsconfig.json
COPY apps/backend/tsconfig.build.json ./apps/backend/tsconfig.build.json
COPY apps/backend/tsconfig.runtime.json ./apps/backend/tsconfig.runtime.json
COPY tsconfig.json ./tsconfig.json

# Copy built artifacts from build stages
COPY --from=backend-build /usr/src/app/apps/backend/dist ./apps/backend/dist
COPY --from=backend-build /usr/src/app/packages/types/dist ./packages/types/dist
COPY --from=backend-build /usr/src/app/packages/utils/dist ./packages/utils/dist

# Copy node_modules from pruned stage (production dependencies only)
# .npmrc from base stage ensures hoisted structure  
COPY --from=pruned /usr/src/app/node_modules ./node_modules
COPY --from=pruned /usr/src/app/.npmrc ./.npmrc

# Verify critical files exist before starting container
# This prevents MODULE_NOT_FOUND errors at runtime
# Check both possible locations (webpack bundle vs tsc output)
RUN (test -f apps/backend/dist/main.js && echo "✓ Verified: apps/backend/dist/main.js exists") || \
    (test -f apps/backend/dist/src/main.js && echo "✓ Verified: apps/backend/dist/src/main.js exists (will use this path)") || \
    (echo "✗ CRITICAL: main.js not found in apps/backend/dist/ or apps/backend/dist/src/" && \
     echo "Build output structure:" && find apps/backend/dist -name "main.js" && ls -la apps/backend/dist/ && \
     exit 1)

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:80/api/health || exit 1

# Make entrypoint script executable
RUN chmod +x /usr/src/app/apps/backend/docker-entrypoint.sh

# Run the application
# IMPORTANT: NestJS builds to dist/ relative to apps/backend directory
# Build command: cd apps/backend && npx nest build --webpack
# Output location: apps/backend/dist/main.js (webpack bundle) OR apps/backend/dist/src/main.js (tsc output)
# Entrypoint script handles both cases
ENTRYPOINT ["/usr/src/app/apps/backend/docker-entrypoint.sh"]
