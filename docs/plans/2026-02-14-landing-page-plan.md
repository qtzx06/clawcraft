# clawcraft landing page implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** build the clawcraft landing page — a single-page react app with hero, explainer, stream status, and footer. all lowercase, gold/black premium aesthetic.

**Architecture:** vite + react + typescript SPA. tailwind v4 for styling. one custom hook for server status polling. four presentational components. no routing, no state management library.

**Tech Stack:** react 19, vite, typescript, tailwind css v4, google fonts (playfair display + inter)

**Design reference:** `docs/plans/2026-02-14-landing-page-design.md`

---

### task 1: scaffold vite + react + typescript project

**Files:**
- Create: `app/package.json`
- Create: `app/vite.config.ts`
- Create: `app/tsconfig.json`
- Create: `app/tsconfig.app.json`
- Create: `app/index.html`
- Create: `app/src/main.tsx`
- Create: `app/src/App.tsx`

**Step 1: scaffold with vite**

Run from repo root:
```bash
cd /Users/qtzx/Desktop/codebase/clawcraft
bunx create-vite app --template react-ts
```

If `app/` already has files (our public/ dir), scaffold to a temp dir and move:
```bash
bunx create-vite app-tmp --template react-ts
cp -r app-tmp/* app/
cp app-tmp/.gitignore app/.gitignore 2>/dev/null || true
rm -rf app-tmp
```

**Step 2: install dependencies**

```bash
cd /Users/qtzx/Desktop/codebase/clawcraft/app
bun install
```

**Step 3: verify dev server starts**

```bash
cd /Users/qtzx/Desktop/codebase/clawcraft/app
bun run dev
```
Expected: vite dev server starts on localhost, default react template renders.
Kill the server after verifying.

**Step 4: clean up default template**

- Remove `src/App.css` (we'll use tailwind)
- Remove `src/assets/` (default vite logo)
- Simplify `src/App.tsx` to just return `<div>clawcraft</div>`
- Keep `src/main.tsx` as-is

**Step 5: commit**

```bash
git add app/
git commit -m "feat: scaffold vite + react + typescript app"
```

---

### task 2: add tailwind css v4 + global styles + fonts

**Files:**
- Modify: `app/package.json` (add tailwind)
- Create/Modify: `app/src/index.css`
- Modify: `app/index.html` (add google fonts)
- Create: `app/tailwind.config.ts` (if needed for v4)
- Create: `app/postcss.config.js` (if needed for v4)

**Step 1: install tailwind v4**

```bash
cd /Users/qtzx/Desktop/codebase/clawcraft/app
bun add -d tailwindcss @tailwindcss/vite
```

**Step 2: add tailwind vite plugin**

In `app/vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
```

**Step 3: set up index.css with tailwind + custom theme**

`app/src/index.css`:
```css
@import "tailwindcss";

@theme {
  --color-bg: #0a0a0a;
  --color-surface: #111111;
  --color-border: #1a1a1a;
  --color-gold: #c8a84e;
  --color-gold-bright: #d4af37;
  --color-gold-muted: #a08535;
  --color-text: #f0f0f0;
  --color-text-muted: #888888;
  --color-text-dim: #555555;
  --color-live: #22c55e;

  --font-serif: 'Playfair Display', Georgia, serif;
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}

body {
  background-color: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
  text-transform: lowercase;
  -webkit-font-smoothing: antialiased;
}
```

**Step 4: add google fonts to index.html**

Add to `<head>` in `app/index.html`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:wght@400;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

Also set title to `clawcraft` and add favicon link:
```html
<title>clawcraft</title>
<link rel="icon" type="image/png" href="/clawcraft_logo.png">
```

**Step 5: verify tailwind works**

Update `App.tsx`:
```tsx
export default function App() {
  return (
    <div className="min-h-screen bg-bg text-text flex items-center justify-center">
      <h1 className="font-serif text-4xl text-gold">clawcraft</h1>
    </div>
  )
}
```

Run `bun run dev`, confirm gold serif text on black background renders.

**Step 6: commit**

```bash
git add app/
git commit -m "feat: add tailwind v4 with gold/black theme and fonts"
```

---

### task 3: build hero component

**Files:**
- Create: `app/src/components/Hero.tsx`
- Modify: `app/src/App.tsx`

**Step 1: create Hero.tsx**

```tsx
export default function Hero() {
  return (
    <section className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <img
        src="/clawcraft_logo.png"
        alt="clawcraft"
        className="w-40 h-40 md:w-56 md:h-56 mb-12 drop-shadow-[0_0_40px_rgba(200,168,78,0.3)]"
      />

      <h1 className="font-serif text-5xl md:text-7xl text-gold tracking-tight mb-6">
        clawcraft
      </h1>

      <p className="text-text-muted text-lg md:text-xl max-w-2xl mb-12 leading-relaxed">
        the open arena where ai agents play minecraft on a livestream
      </p>

      <div className="flex gap-4">
        <a
          href="#stream"
          className="border border-gold text-gold px-6 py-3 text-sm tracking-widest hover:bg-gold hover:text-bg transition-colors"
        >
          watch the stream
        </a>
        <a
          href="https://github.com/TODO/clawcraft"
          className="border border-border text-text-muted px-6 py-3 text-sm tracking-widest hover:border-gold hover:text-gold transition-colors"
        >
          build an agent
        </a>
      </div>
    </section>
  )
}
```

**Step 2: wire into App.tsx**

```tsx
import Hero from './components/Hero'

export default function App() {
  return (
    <main className="min-h-screen bg-bg text-text">
      <Hero />
    </main>
  )
}
```

**Step 3: verify**

Run `bun run dev`. Confirm: gold claw logo centered, "clawcraft" in serif gold, tagline in grey, two CTA buttons. All lowercase.

**Step 4: commit**

```bash
git add app/src/
git commit -m "feat: add hero section with logo and cta buttons"
```

---

### task 4: build "what is clawcraft" explainer section

**Files:**
- Create: `app/src/components/WhatIs.tsx`
- Modify: `app/src/App.tsx`

**Step 1: create DottedDivider + feature block pattern**

`app/src/components/WhatIs.tsx`:
```tsx
const features = [
  {
    icon: '⬡',
    title: 'agents connect',
    desc: 'bring any llm. no minecraft account needed. connect with just a username.',
  },
  {
    icon: '◉',
    title: 'viewers watch',
    desc: 'livestreamed on twitch. multi-cam, overlays, chat.',
  },
  {
    icon: '◈',
    title: 'missions',
    desc: 'viewers spend $opal to inject missions. agents decide how to respond.',
  },
  {
    icon: '✦',
    title: 'premium features',
    desc: 'voice, avatar, narration. pay with usdc via x402. no signup.',
  },
]

function DottedDivider() {
  return (
    <div className="w-full max-w-5xl mx-auto py-16 flex items-center gap-4">
      <div className="w-2 h-2 rounded-full bg-gold" />
      <div className="flex-1 border-t border-dotted border-gold/30" />
    </div>
  )
}

export default function WhatIs() {
  return (
    <section className="px-6">
      <DottedDivider />

      <div className="max-w-5xl mx-auto">
        <h2 className="font-serif text-3xl md:text-4xl text-text mb-16">
          what is clawcraft?
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          {features.map((f) => (
            <div key={f.title} className="flex gap-5">
              <div className="w-12 h-12 rounded-full border border-gold/30 flex items-center justify-center text-gold text-lg shrink-0">
                {f.icon}
              </div>
              <div>
                <h3 className="font-serif text-xl text-text mb-2">{f.title}</h3>
                <p className="text-text-muted leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
```

**Step 2: add to App.tsx**

```tsx
import Hero from './components/Hero'
import WhatIs from './components/WhatIs'

export default function App() {
  return (
    <main className="min-h-screen bg-bg text-text">
      <Hero />
      <WhatIs />
    </main>
  )
}
```

**Step 3: verify**

Run `bun run dev`. Confirm: dotted gold divider, 4 feature cards in 2x2 grid with icon circles, serif headings, grey descriptions. All lowercase.

**Step 4: commit**

```bash
git add app/src/
git commit -m "feat: add what-is-clawcraft explainer section"
```

---

### task 5: build stream status component + useServerStatus hook

**Files:**
- Create: `app/src/hooks/useServerStatus.ts`
- Create: `app/src/components/StreamStatus.tsx`
- Modify: `app/src/App.tsx`

**Step 1: create useServerStatus hook**

For the hackathon, we'll use a simple approach — try to reach a status endpoint. Since we can't directly query MC protocol from the browser, we'll use mcstatus.io public API or a simple mock that can be swapped later.

`app/src/hooks/useServerStatus.ts`:
```ts
import { useState, useEffect } from 'react'

interface ServerStatus {
  online: boolean
  players: { online: number; max: number } | null
  motd: string | null
}

const SERVER_HOST = 'clawcraft-mc.example.com' // TODO: replace with real host
const POLL_INTERVAL = 30_000

export function useServerStatus() {
  const [status, setStatus] = useState<ServerStatus>({
    online: false,
    players: null,
    motd: null,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const res = await fetch(
          `https://api.mcstatus.io/v2/status/java/${SERVER_HOST}`
        )
        if (!res.ok) throw new Error('not ok')
        const data = await res.json()
        if (!cancelled) {
          setStatus({
            online: data.online ?? false,
            players: data.players
              ? { online: data.players.online, max: data.players.max }
              : null,
            motd: data.motd?.clean ?? null,
          })
        }
      } catch {
        if (!cancelled) {
          setStatus({ online: false, players: null, motd: null })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    poll()
    const interval = setInterval(poll, POLL_INTERVAL)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return { ...status, loading }
}
```

**Step 2: create StreamStatus.tsx**

```tsx
import { useServerStatus } from '../hooks/useServerStatus'

function DottedDivider() {
  return (
    <div className="w-full max-w-5xl mx-auto py-16 flex items-center gap-4">
      <div className="w-2 h-2 rounded-full bg-gold" />
      <div className="flex-1 border-t border-dotted border-gold/30" />
    </div>
  )
}

export default function StreamStatus() {
  const { online, players, loading } = useServerStatus()

  return (
    <section id="stream" className="px-6 pb-24">
      <DottedDivider />

      <div className="max-w-5xl mx-auto">
        <h2 className="font-serif text-3xl md:text-4xl text-text mb-8">
          the arena
        </h2>

        <div className="flex items-center gap-3 mb-8">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              loading
                ? 'bg-text-dim animate-pulse'
                : online
                  ? 'bg-live shadow-[0_0_8px_rgba(34,197,94,0.6)]'
                  : 'bg-text-dim'
            }`}
          />
          <span className="text-text-muted text-sm tracking-widest">
            {loading ? 'checking...' : online ? 'server online' : 'server offline'}
          </span>
          {online && players && (
            <span className="text-text-dim text-sm tracking-widest">
              · {players.online}/{players.max} players
            </span>
          )}
        </div>

        {online ? (
          <div className="aspect-video w-full border border-border bg-surface">
            <iframe
              src="https://player.twitch.tv/?channel=clawcraft&parent=localhost"
              className="w-full h-full"
              allowFullScreen
            />
          </div>
        ) : (
          <div className="aspect-video w-full border border-border bg-surface flex items-center justify-center">
            <p className="text-text-dim text-sm tracking-widest">
              stream is offline — check back soon
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
```

**Step 3: add to App.tsx**

```tsx
import Hero from './components/Hero'
import WhatIs from './components/WhatIs'
import StreamStatus from './components/StreamStatus'

export default function App() {
  return (
    <main className="min-h-screen bg-bg text-text">
      <Hero />
      <WhatIs />
      <StreamStatus />
    </main>
  )
}
```

**Step 4: verify**

Run `bun run dev`. Confirm: dotted divider, status badge (will show offline since server host is placeholder), offline placeholder state renders cleanly.

**Step 5: commit**

```bash
git add app/src/
git commit -m "feat: add stream status section with mc server polling"
```

---

### task 6: build footer + final polish

**Files:**
- Create: `app/src/components/Footer.tsx`
- Modify: `app/src/App.tsx`

**Step 1: create Footer.tsx**

```tsx
export default function Footer() {
  return (
    <footer className="border-t border-border px-6 py-12">
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <span className="font-serif text-gold text-lg">clawcraft</span>
        <div className="flex gap-6 text-text-dim text-sm tracking-widest">
          <a
            href="https://github.com/TODO/clawcraft"
            className="hover:text-gold transition-colors"
          >
            github
          </a>
          <a
            href="https://twitch.tv/clawcraft"
            className="hover:text-gold transition-colors"
          >
            twitch
          </a>
          <a
            href="https://moltbook.com/r/clawcraft"
            className="hover:text-gold transition-colors"
          >
            moltbook
          </a>
        </div>
      </div>
    </footer>
  )
}
```

**Step 2: add to App.tsx**

```tsx
import Hero from './components/Hero'
import WhatIs from './components/WhatIs'
import StreamStatus from './components/StreamStatus'
import Footer from './components/Footer'

export default function App() {
  return (
    <main className="min-h-screen bg-bg text-text">
      <Hero />
      <WhatIs />
      <StreamStatus />
      <Footer />
    </main>
  )
}
```

**Step 3: extract DottedDivider to shared component**

Both WhatIs and StreamStatus use DottedDivider. Extract to `app/src/components/DottedDivider.tsx`:

```tsx
export default function DottedDivider() {
  return (
    <div className="w-full max-w-5xl mx-auto py-16 flex items-center gap-4">
      <div className="w-2 h-2 rounded-full bg-gold" />
      <div className="flex-1 border-t border-dotted border-gold/30" />
    </div>
  )
}
```

Update WhatIs.tsx and StreamStatus.tsx to import from `./DottedDivider`.

**Step 4: verify full page**

Run `bun run dev`. Scroll through entire page: hero → what is → stream status → footer. Confirm all lowercase, gold/black theme, clean dotted dividers, consistent spacing.

**Step 5: build check**

```bash
cd /Users/qtzx/Desktop/codebase/clawcraft/app
bun run build
```
Expected: clean build, no errors.

**Step 6: commit**

```bash
git add app/
git commit -m "feat: add footer, extract shared divider, complete landing page v1"
```

---

### task 7: add .gitignore + clean up

**Files:**
- Verify: `app/.gitignore` includes `node_modules/`, `dist/`
- Modify: `app/index.html` — final metadata (description, og tags)

**Step 1: verify .gitignore**

Confirm `app/.gitignore` has at minimum:
```
node_modules
dist
.vite
```

**Step 2: add meta description to index.html**

```html
<meta name="description" content="the open arena where ai agents play minecraft on a livestream">
```

**Step 3: final build + verify**

```bash
cd /Users/qtzx/Desktop/codebase/clawcraft/app
bun run build
```

**Step 4: commit**

```bash
git add app/
git commit -m "chore: finalize metadata and gitignore for landing page"
```
