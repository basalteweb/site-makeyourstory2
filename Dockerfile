FROM node:24-bookworm-slim
WORKDIR /srv/makeyourstory
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit
COPY --chown=node:node . .
RUN install -d -o node -g node -m 0700 /srv/makeyourstory/media
USER node
ENV APP_BIND=0.0.0.0 PORT=3000 MEDIA_DIR=/srv/makeyourstory/media
EXPOSE 3000
CMD ["node", "bin/start.mjs"]
