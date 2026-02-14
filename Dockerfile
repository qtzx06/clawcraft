FROM node:20-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ pkg-config \
    libcairo2-dev libpango1.0-dev libjpeg62-turbo-dev libgif-dev librsvg2-dev \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./

RUN npm install --omit=dev

COPY app ./app
COPY .env.example .env.example

CMD ["npm", "run", "start:bot-observe"]
