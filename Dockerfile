FROM node:22-bookworm-slim

# codex serves the Codex limits (codex app-server); claude is only used for the one-time login
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @openai/codex@0.166.0 @anthropic-ai/claude-code@2.1.311 \
 && npm cache clean --force \
 && mkdir -p /data/codex /data/claude && chown -R node:node /data

# Logins live in the /data volume, separate from any interactive Claude Code / Codex on the host
ENV CODEX_HOME=/data/codex \
    CLAUDE_CONFIG_DIR=/data/claude \
    CLAUDE_REFRESH=1 \
    HOST=0.0.0.0 \
    PORT=8787

WORKDIR /app
COPY server server
COPY web web

USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s \
  CMD node -e "fetch('http://127.0.0.1:8787/').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server/server.js"]
