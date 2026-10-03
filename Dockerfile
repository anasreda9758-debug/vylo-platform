# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time stand-ins only: never pass real DB/auth secrets into image layers.
# Dynamic routes do not query this nonexistent DB during the production build.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:9/build \
    BETTER_AUTH_URL=https://build.invalid \
    BETTER_AUTH_SECRET=build-only-placeholder-not-for-runtime \
    npm run build

# Optional maintenance image only; never the default application image.
FROM builder AS seed
ENV NODE_ENV=production
CMD ["node_modules/.bin/tsx", "scripts/staging-seed.ts"]

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder /app/scripts/validate-staging-env.mjs ./scripts/validate-staging-env.mjs

# Never ship env files that Next may copy into the standalone output.
RUN rm -f .env .env.local .env.development .env.production .env.staging

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
