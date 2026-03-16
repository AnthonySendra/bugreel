# ---- build stage ----
FROM node:24-alpine AS builder

WORKDIR /build

COPY app/package.json app/package-lock.json ./
RUN npm ci

COPY app/ .
RUN npm run build

# ---- runtime stage ----
FROM node:24-alpine AS runner

WORKDIR /app

# Copy only the built output
COPY --from=builder /build/.output .output

# Data directory (SQLite DB + reel files when using local disk storage)
VOLUME /app/data

EXPOSE 7777

ENV PORT=7777
ENV NODE_ENV=production

CMD ["node", ".output/server/index.mjs"]
