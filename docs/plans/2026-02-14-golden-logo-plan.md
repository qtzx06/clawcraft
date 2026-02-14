# Golden Animated Logo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the PNG logo with live-rendered text in a Minecraft pixel font, filled with an animated flowing gold gradient and marble vein texture.

**Architecture:** CSS `background-clip: text` with animated multi-stop gold gradient, layered with SVG turbulence noise for marble vein texture. Text rendered with "Press Start 2P" pixel font from Google Fonts.

**Tech Stack:** React, Tailwind CSS 4, CSS animations, Google Fonts

---

### Task 1: Add "Press Start 2P" font

**Files:**
- Modify: `index.html:11`
- Modify: `src/index.css:15-17`

**Step 1: Add font to Google Fonts link**

In `index.html`, replace line 11:

```html
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&family=Playfair+Display:wght@400;700&family=JetBrains+Mono:wght@400;500&family=Press+Start+2P&display=swap" rel="stylesheet" />
```

**Step 2: Register font in Tailwind theme**

In `src/index.css`, add after line 17 (`--font-mono`):

```css
--font-pixel: 'Press Start 2P', 'Courier New', monospace;
```

**Step 3: Verify font loads**

Run: `bun run dev`

Open browser, inspect element, confirm "Press Start 2P" appears in the font list in DevTools Network tab.

**Step 4: Commit**

```bash
git add index.html src/index.css
git commit -m "feat: add Press Start 2P pixel font"
```

---

### Task 2: Add gold-flow animation and gold-text class

**Files:**
- Modify: `src/index.css:67-74` (after existing shimmer keyframes area)

**Step 1: Add gold-flow keyframes and utility class**

In `src/index.css`, add after the `@keyframes shimmer` block (after line 74):

```css
@keyframes gold-flow {
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0% 50%;
  }
}

.gold-text {
  background: linear-gradient(
    -45deg,
    #8B6914 0%,
    #c8a84e 15%,
    #f5e6a3 30%,
    #d4af37 45%,
    #8B6914 55%,
    #c8a84e 70%,
    #f5e6a3 85%,
    #8B6914 100%
  );
  background-size: 400% 400%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: gold-flow 8s ease infinite;
  filter: drop-shadow(0 0 30px rgba(200, 168, 78, 0.3));
}
```

**Step 2: Verify in browser**

Temporarily add `gold-text` class to the existing `<h1>clawcraft</h1>` in Hero.tsx to see the effect. Confirm the gold gradient flows diagonally across the text.

**Step 3: Revert the temporary test, then commit**

```bash
git add src/index.css
git commit -m "feat: add gold-flow animation and gold-text utility"
```

---

### Task 3: Add marble vein SVG noise texture class

**Files:**
- Modify: `src/index.css` (add after `.gold-text` block)

**Step 1: Add the vein texture class**

```css
.gold-text-veined {
  position: relative;
}

.gold-text-veined::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='v'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.03' numOctaves='3' seed='5' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23v)'/%3E%3C/svg%3E");
  background-size: cover;
  mix-blend-mode: overlay;
  opacity: 0.15;
  pointer-events: none;
}
```

**Step 2: Commit**

```bash
git add src/index.css
git commit -m "feat: add marble vein texture overlay class"
```

---

### Task 4: Replace Hero logo with golden text

**Files:**
- Modify: `src/components/Hero.tsx:11-19`

**Step 1: Replace the `<img>` and merge with existing `<h1>`**

Replace lines 11-19 (the `<img>` tag and the `<h1>` tag) with a single golden text element:

```tsx
<h1 className="relative z-10 font-pixel text-4xl md:text-6xl gold-text gold-text-veined tracking-wide mb-6 animate-fade-up">
  clawcraft
</h1>
```

This replaces both the PNG logo image AND the existing "clawcraft" `<h1>` (which would be redundant since the logo IS the text now).

**Step 2: Verify in browser**

Run: `bun run dev`

Confirm:
- Text renders in pixel font
- Gold gradient flows through the letters
- Marble vein texture is visible as subtle overlay
- Gold glow radiates around text
- Fade-up entrance animation works

**Step 3: Adjust spacing if needed**

The old logo had `mb-14` and the old h1 had `mb-6`. The new combined element uses `mb-6` — adjust if spacing feels off between the logo and subtitle.

**Step 4: Commit**

```bash
git add src/components/Hero.tsx
git commit -m "feat: replace hero PNG logo with golden animated text"
```

---

### Task 5: Update Footer logo

**Files:**
- Modify: `src/components/Footer.tsx:6-13`

**Step 1: Replace the `<img>` and `<span>` with unified golden text**

Replace lines 6-13 with:

```tsx
<span className="font-pixel text-xs gold-text tracking-wide">
  clawcraft
</span>
```

**Step 2: Verify in browser**

Confirm the footer shows "clawcraft" in the pixel font with gold effect at a small size.

**Step 3: Commit**

```bash
git add src/components/Footer.tsx
git commit -m "feat: replace footer PNG logo with golden text"
```

---

### Task 6: Clean up old shimmer animation

**Files:**
- Modify: `src/index.css:67-74,89-91`

**Step 1: Remove old shimmer keyframes and class**

The `@keyframes shimmer` and `.animate-shimmer` class were only used on the PNG logo which is now removed. Delete them:

- Delete `@keyframes shimmer` block (lines 67-74)
- Delete `.animate-shimmer` class (lines 89-91)

**Step 2: Verify nothing else references shimmer**

Search the codebase for `shimmer` — confirm no other component uses it.

**Step 3: Commit**

```bash
git add src/index.css
git commit -m "chore: remove unused shimmer animation"
```

---

### Task 7: Visual polish and final review

**Step 1: Open the site and review the full page**

Run: `bun run dev`

Check:
- Hero golden text looks premium and the animation flows smoothly
- Footer text matches the style at small size
- No layout shifts or spacing issues
- Mobile responsive (check smaller viewport)
- Gold glow effect complements the dark background
- The marble vein overlay adds depth without being distracting

**Step 2: Adjust animation timing/colors if needed**

Potential tweaks:
- `gold-flow` duration (currently 8s) — slower = more elegant, faster = more dynamic
- Gradient color stops — add/remove stops for more/less contrast
- Vein texture opacity (currently 0.15) — increase for more visible veins
- Drop shadow intensity

**Step 3: Final commit if any tweaks were made**

```bash
git add -A
git commit -m "style: polish golden logo animation"
```
