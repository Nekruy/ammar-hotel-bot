# docker/Dockerfile
FROM node:20-alpine

# Зависимости для Puppeteer (WhatsApp)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build
RUN npx prisma generate

RUN mkdir -p logs whatsapp-session

EXPOSE 3000
CMD ["node", "dist/server/index.js"]
