# ClawCraft Frontend

This is the standalone web frontend (Vite + React) extracted from the old `test` branch `app/`.

## Local Dev

```bash
cd frontend
bun install
bun run dev
```

## Deploy (Vercel)

```bash
cd frontend
bunx vercel deploy
```

Notes:
- `frontend/vercel.json` redirects `/agents.md` to the GitHub `AGENTS.md` source of truth.

