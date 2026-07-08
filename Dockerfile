# syntax=docker/dockerfile:1

# ---------- Builder ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# openssl so Prisma detects the right engine (debian-openssl-3.0.x) at generate time
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# Install deps first for better layer caching. Use `npm install` (not `npm ci`)
# so a local↔container npm version skew in the lockfile doesn't break the build.
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund --loglevel=error

# Copy source and build (Prisma client + Next build with the Workflow compiler).
# Several routes construct OpenAI/Groq SDK clients at module load, which `next build`
# evaluates — so provide PLACEHOLDER keys at build time. Real values are injected
# at runtime via the container env; these placeholders never ship in the image env.
COPY . .
ENV OPENAI_API_KEY=sk-build-placeholder \
    GROQ_API_KEY=gsk-build-placeholder \
    NEXTAUTH_SECRET=build-time-placeholder
RUN npx prisma generate \
    && npm run build

# ---------- Runner ----------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# ffmpeg for the transcription pipeline. System ffmpeg reads S3 over HTTPS
# reliably (unlike the static build), and media.ts auto-selects /usr/bin/ffmpeg
# when not on Vercel.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

# Copy the built app + installed deps (includes the generated Prisma client)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/prisma ./prisma
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
