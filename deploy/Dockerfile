# Dart-Turnier: ein einziger Node-Prozess liefert die App UND die API aus.
#
# Kein Build-Schritt, keine npm-Abhaengigkeiten: SQLite steckt seit Node 22.5
# in der Laufzeit (node:sqlite). Deshalb reicht ein Image ohne Compiler,
# ohne Python und ohne node_modules -- rund 60 MB statt einiger hundert.
FROM node:24-alpine

# tini raeumt Zombie-Prozesse ab und leitet SIGTERM sauber weiter, damit
# SQLite seinen WAL-Stand beim Stoppen noch schreiben kann.
RUN apk add --no-cache tini

WORKDIR /app

# Nur was zur Laufzeit gebraucht wird. Tests, .git und der Design-Kram
# bleiben draussen (siehe .dockerignore).
COPY server ./server
COPY index.html manifest.webmanifest sw.js ./
COPY css ./css
COPY js ./js
COPY icons ./icons
COPY fonts ./fonts

# Die Datenbank liegt im Volume, nicht im Image.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

ENV NODE_ENV=production \
    PORT=3002 \
    HOST=0.0.0.0 \
    DARTS_DB=/data/darts.db

EXPOSE 3002

# Ein eigener Healthcheck, damit `docker compose ps` die Wahrheit sagt.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3002/api/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/main.mjs"]
