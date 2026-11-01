FROM node:24.21.0-bookworm-slim AS builder
WORKDIR /app
# koffi and node-pty compile native addons during install, and node-pty ships no
# Linux prebuild, so the builder image needs a C++ toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm --filter server build

FROM node:24.21.0-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl libfontconfig1 && rm -rf /var/lib/apt/lists/*
# The video-link import spawns yt-dlp to download a remote video before the
# server stores and packages it. Install the self-contained release binary at
# build time: the site extractors of a video site change often, so a current
# release is necessary and a distro package is usually stale. The binary needs
# no Python runtime. Set `YT_DLP_PATH` in the server environment to override it.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) yt_dlp_asset=yt-dlp_linux ;; \
      arm64) yt_dlp_asset=yt-dlp_linux_aarch64 ;; \
      *) echo "No self-contained yt-dlp release for architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL --retry 3 -o /usr/local/bin/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${yt_dlp_asset}"; \
    chmod +x /usr/local/bin/yt-dlp; \
    yt-dlp --version
WORKDIR /app
ENV NODE_ENV=production PORT=3001
# apps/server/dist carries node_modules from the build stage: the external
# packages and the MXC bin/<arch> native assets resolve from there.
COPY --from=builder --chown=node:node /app/apps/server/dist ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.mjs"]
