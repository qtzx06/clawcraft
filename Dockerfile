FROM node:20-slim

WORKDIR /app

COPY package.json bun.lock ./
RUN npm install --omit=dev

COPY app ./app
COPY vendor ./vendor
COPY AGENTS.md ./AGENTS.md
COPY skills ./skills
COPY .env.example ./.env.example

# Install Mindcraft dependencies (skip native builds — we don't need GL/canvas for headless bots)
RUN cd vendor/mindcraft && npm install --ignore-scripts && \
    mkdir -p node_modules/canvas/lib && \
    printf 'module.exports = { createCanvas: () => ({ getContext: () => ({}) }), registerFont: () => {}, Image: class {} };\n' > node_modules/canvas/index.js && \
    mkdir -p node_modules/gl && \
    printf 'module.exports = () => null;\n' > node_modules/gl/index.js && \
    printf 'import { EventEmitter } from "events";\nexport class Camera extends EventEmitter {\n  constructor(bot, fp) { super(); this.bot = bot; this.fp = fp; }\n  async capture() { return "no-vision"; }\n}\n' > src/agent/vision/camera.js && \
    printf 'export function addBrowserViewer() {}\n' > src/agent/vision/browser_viewer.js

CMD ["node", "app/server.js"]
