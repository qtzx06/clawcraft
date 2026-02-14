# Golden Animated Logo Design

## Summary

Replace the current PNG logo with live-rendered text using a Minecraft pixel font, filled with an animated flowing gold gradient and marble vein texture.

## Font

Use **"Press Start 2P"** from Google Fonts — a free pixel/blocky font matching the Minecraft aesthetic. Load via the existing Google Fonts CDN link in `index.html`.

## Gold Effect: CSS `background-clip: text`

- Multi-stop linear gradient: dark gold (`#8B6914`) -> gold (`#c8a84e`) -> bright gold (`#d4af37`) -> white-gold (`#f5e6a3`) -> dark gold
- `background-clip: text` + `color: transparent` to fill letter shapes
- `background-size: 400% 400%` for gradient travel room

## Flowing Animation

- CSS `@keyframes gold-flow` animating `background-position` diagonally over ~8s, infinite
- Creates the illusion of golden veins/rivers flowing through text

## Marble Vein Texture

- SVG `<feTurbulence>` noise pattern layered as texture
- Low opacity for organic marble-vein feel (matching the gold marble reference)

## Glow

- Retain existing gold `drop-shadow` shimmer animation
- Warm gold glow (`#c8a84e`) radiating from text

## Files Changed

| File | Change |
|------|--------|
| `index.html` | Add "Press Start 2P" to Google Fonts link |
| `src/index.css` | Add `gold-flow` keyframes, gold text utility classes |
| `src/components/Hero.tsx` | Replace `<img>` logo with styled text element |
| `src/components/Footer.tsx` | Replace small `<img>` logo with text treatment |

## What Stays

- Fade-up entrance animation
- Dark theme + gold color palette
- Overall page layout and structure
