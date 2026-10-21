# Sanal Türkiye — üretim imajı (Node 24, better-sqlite3 derlemesi için çok aşamalı)
FROM node:24-bookworm-slim AS derleme
WORKDIR /uygulama
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3400 VERI_DIZINI=/veri
WORKDIR /uygulama
COPY --from=derleme /uygulama/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY db ./db
# Veri (SQLite, karo önbelleği, yedekler, günlükler) kalıcı birimde; kök olmayan kullanıcıyla çalışır
RUN mkdir -p /veri && chown -R node:node /veri
USER node
VOLUME ["/veri"]
EXPOSE 3400
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3400)+'/api/saglik').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
