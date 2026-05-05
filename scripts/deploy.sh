#!/bin/bash
# scripts/deploy.sh — Полный скрипт деплоя на VPS (Ubuntu 22.04)
# Запускать: bash deploy.sh
# ═══════════════════════════════════════════════════════

set -e  # Останавливаться при ошибках
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  AMMAR Hotel Bot — Деплой на VPS       ${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}\n"

# ── 1. ОБНОВЛЕНИЕ СИСТЕМЫ ───────────────────────────────
echo -e "${YELLOW}[1/8] Обновление системы...${NC}"
apt-get update -qq && apt-get upgrade -y -qq
echo -e "${GREEN}✅ Система обновлена${NC}\n"

# ── 2. УСТАНОВКА NODE.JS 20 ────────────────────────────
echo -e "${YELLOW}[2/8] Установка Node.js 20...${NC}"
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y nodejs -qq
fi
echo -e "${GREEN}✅ Node.js $(node --version)${NC}\n"

# ── 3. УСТАНОВКА PM2 ───────────────────────────────────
echo -e "${YELLOW}[3/8] Установка PM2...${NC}"
npm install -g pm2 >/dev/null 2>&1
echo -e "${GREEN}✅ PM2 $(pm2 --version)${NC}\n"

# ── 4. POSTGRESQL ──────────────────────────────────────
echo -e "${YELLOW}[4/8] Установка PostgreSQL...${NC}"
if ! command -v psql &>/dev/null; then
  apt-get install -y postgresql postgresql-contrib -qq
  systemctl enable --now postgresql
  # Создать пользователя и БД
  sudo -u postgres psql << SQL
CREATE USER ammar WITH PASSWORD 'strongpassword123';
CREATE DATABASE ammar_bot OWNER ammar;
SQL
fi
echo -e "${GREEN}✅ PostgreSQL установлен${NC}\n"

# ── 5. REDIS ───────────────────────────────────────────
echo -e "${YELLOW}[5/8] Установка Redis...${NC}"
if ! command -v redis-cli &>/dev/null; then
  apt-get install -y redis-server -qq
  systemctl enable --now redis-server
fi
echo -e "${GREEN}✅ Redis установлен${NC}\n"

# ── 6. ПРОЕКТ ─────────────────────────────────────────
echo -e "${YELLOW}[6/8] Настройка проекта...${NC}"
mkdir -p /var/www/ammar-bot
cd /var/www/ammar-bot

# Если .env не существует — создать из примера
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo -e "${YELLOW}⚠️  Создан .env из .env.example — ЗАПОЛНИТЕ КЛЮЧИ!${NC}"
    echo -e "${YELLOW}   Редактируйте: nano /var/www/ammar-bot/.env${NC}"
  fi
fi

npm install >/dev/null 2>&1
npm run build
npx prisma db push
echo -e "${GREEN}✅ Проект собран${NC}\n"

# ── 7. NGINX + SSL ─────────────────────────────────────
echo -e "${YELLOW}[7/8] Настройка Nginx...${NC}"
apt-get install -y nginx certbot python3-certbot-nginx -qq
cp nginx/nginx.conf /etc/nginx/nginx.conf
nginx -t && systemctl reload nginx
echo -e "${GREEN}✅ Nginx настроен${NC}\n"

# ── 8. PM2 ЗАПУСК ─────────────────────────────────────
echo -e "${YELLOW}[8/8] Запуск бота через PM2...${NC}"
pm2 stop ammar-bot 2>/dev/null || true
pm2 start dist/server/index.js --name ammar-bot \
  --max-memory-restart 512M \
  --log logs/pm2.log
pm2 save
pm2 startup | tail -1 | bash
echo -e "${GREEN}✅ Бот запущен!${NC}\n"

echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  ДЕПЛОЙ ЗАВЕРШЁН УСПЕШНО! 🎉            ${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo "Проверить статус: pm2 status"
echo "Смотреть логи:    pm2 logs ammar-bot"
echo "Health check:     curl http://localhost:3000/health"
echo ""
echo -e "${YELLOW}Не забудьте заполнить /var/www/ammar-bot/.env!${NC}"
