FROM node:20-slim

WORKDIR /app

COPY package.json bun.lock ./
RUN npm install --omit=dev

COPY app ./app
COPY .env.example ./.env.example

CMD ["node", "app/server.js"]
