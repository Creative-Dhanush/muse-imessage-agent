FROM oven/bun:1-debian
# ffmpeg lets Muse transcribe iMessage voice notes (.caf → mp3)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production || bun install --production
COPY . .
# SQLite lives here — mount a persistent volume at /data so notes & reminders survive redeploys
ENV MUSE_DB_PATH=/data/muse.db
VOLUME ["/data"]
CMD ["bun", "src/index.ts"]
