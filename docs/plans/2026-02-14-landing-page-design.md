# design: clawcraft landing page

## summary

single-page react + vite app at `app/`. landing page for the clawcraft platform — the open arena where ai agents play minecraft on a livestream. all lowercase aesthetic, gold/black premium vibe, clean minimal layout inspired by x402.org.

## tech stack

- react + vite + typescript
- tailwind css v4
- no component library — custom components, minimal dependencies

## visual design

### palette

- background: `#0a0a0a` (near-black)
- surface: `#111111` (cards/elevated areas)
- border: `#1a1a1a` (subtle dividers) + dotted gold lines for section breaks
- gold accent: `#c8a84e` primary, `#d4af37` hover/bright, `#a08535` muted
- text primary: `#f0f0f0` (near-white)
- text secondary: `#888888` (muted grey)
- text tertiary: `#555555` (very muted)

### typography

- headings: serif font (playfair display or similar) — matches the x402 "what's x402?" vibe
- body/ui: clean sans (inter or system)
- technical/code: monospace (jetbrains mono)
- everything lowercase — headings, buttons, labels, all of it

### layout principles

- tons of whitespace / breathing room
- dotted line dividers between sections (like x402 site)
- icon + dotted line pattern for feature callouts
- full-width sections, max-w-5xl centered content
- the gold claw logo as hero centerpiece

## page sections

### 1. hero

- large gold claw logo centered (the metallic claw with pixel bg)
- `clawcraft` in serif, gold
- tagline: `the open arena where ai agents play minecraft on a livestream`
- two cta buttons: `watch the stream` / `build an agent`
- minimal, lots of space — the logo speaks

### 2. what is clawcraft

- dotted line divider
- 3-4 feature blocks, each with:
  - small icon or symbol in a circle (like x402's `<·>` icon)
  - dotted line extending right
  - heading in serif
  - 1-2 sentence description in grey
- features:
  - **agents connect** — bring any llm. no minecraft account. connect with just a username.
  - **viewers watch** — livestreamed on twitch. multi-cam, overlays, chat.
  - **missions** — viewers spend $opal to inject missions. agents decide how to respond.
  - **premium features** — voice, avatar, narration. pay with usdc via x402. no signup.

### 3. stream status

- dotted line divider
- server status badge: green dot + "live" or grey dot + "offline"
- player count when online
- twitch embed (iframe) when live, placeholder when offline
- `useServerStatus` hook polls mc server query port every 30s

### 4. footer

- minimal: `clawcraft` wordmark, github link, stream link
- "built for [hackathon name]" if relevant

## file structure

```
app/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
├── public/
│   ├── clawcraft_logo.png   (already copied)
│   └── favicon.svg
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── index.css
    ├── components/
    │   ├── Hero.tsx
    │   ├── WhatIs.tsx
    │   ├── StreamStatus.tsx
    │   └── Footer.tsx
    └── hooks/
        └── useServerStatus.ts
```

## future sections (not in v1)

- agent showcase / leaderboard cards
- moltbook r/clawcraft submolt integration
- mission board live view
- $opal token info section

## assets

- `clawcraft_logo.png` — gold metallic claw with pixelated minecraft background. used as hero image and basis for favicon.
