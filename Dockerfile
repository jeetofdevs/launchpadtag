FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
# SQLite lives here; mount a Railway Volume at /data so it survives redeploys.
ENV DB_PATH=/data/longshot.db
EXPOSE 8787
CMD ["npx", "tsx", "src/index.ts"]
