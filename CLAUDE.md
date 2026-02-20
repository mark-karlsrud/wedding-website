# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static wedding website for Sophia Ohler & Mark Karlsrud. Deployed to GitHub Pages at **sophiamark.nyc** (configured via `CNAME`). No build system, no package manager, no framework — pure HTML/CSS/JS.

## Development

**Preview locally:** Open `index.html` directly in a browser, or run a simple dev server:
```bash
python -m http.server 8080
# or
npx serve .
```

**Deploy:** Push to the `main` branch — GitHub Pages deploys automatically.

## Architecture

Single-page site with smooth-scroll navigation. Three files:

- **`index.html`** — All content and inline SVG illustrations. Each major section has an HTML comment header (`<!-- NAVIGATION -->`, `<!-- HERO -->`, etc.)
- **`styles.css`** — All styles, organized with section comments. CSS custom properties at the top under `:root` define the full design system (colors, fonts, spacing).
- **`script.js`** — Self-contained IIFEs: nav scroll/mobile toggle, carousel, RSVP form submission, hero parallax, building1 tiling, and scroll-reveal animations.

## Design System

Defined as CSS custom properties in `styles.css`:

| Token | Value | Usage |
|---|---|---|
| `--cream` / `--cream-dark` | `#F7F4EE` / `#EDE8DF` | Section backgrounds (alternating) |
| `--charcoal` | `#2A2820` | Primary text, SVG strokes |
| `--gold` | `#BF9E6C` | Accents, handwritten labels, event times |
| `--font-serif` | Cormorant Garamond | Headings, names |
| `--font-hand` | Caveat | Handwritten-style labels, day names |
| `--font-body` | Jost | Body text, addresses, nav |

**SVG illustrations** are all inline in `index.html` with `stroke="currentColor"` and `fill="none"`. The NYC skyline uses an `<feTurbulence>` + `<feDisplacementMap>` SVG filter (`id="roughen"`) defined in the hero section to simulate a hand-drawn pen texture.

## Hero Parallax Skyline

PNG images in `hero/` are layered inside `.hero-parallax` (6 `.parallax-layer` divs). The JS (`initParallax` IIFE) drives a **spread-to-converge** effect: at scroll=0 each layer starts at a different vertical offset (spread apart), and as you scroll through the hero they converge to `translateY(0)`.

**Layer order in HTML** (nth-child 1→6, z-index low→high):

| Slot | Image | Horizontal position |
|---|---|---|
| 1 | `building4.png` | far left |
| 2 | `building2.png` | far right |
| 3 | `building1.png` | tiled left→right |
| 4 | `building3.png` | center (scaled 1.3×) |
| 5 | `bridge.png` | far left |
| 6 | `statue.png` | far right |

**Spread offsets** (in `script.js`, `spreadOffsets` array, index matches slot−1): `[-230, -135, -90, -80, -25, -12]` px. More negative = starts higher at scroll=0.

**Horizontal positions** are controlled by nth-child CSS rules in `styles.css` (`justify-content` + `padding-left/right`). To reposition a layer, edit its nth-child rule.

**Size constraints** (in `styles.css`):
- All imgs: `max-height: 55vh` (base rule)
- building4 (slot 1): `max-width: 50vw`; `bottom: -50px`
- building2 (slot 2): `bottom: 40px`
- building1 (slot 3): `max-width: 100vw`; `bottom: 20px`; tiled by `initBuilding1Tile` IIFE — generates enough copies to fill viewport width with alternating `scaleX(-1)` flips; layer extends 40% of a tile beyond each edge
- building3 (slot 4): `transform: scale(1.3); transform-origin: bottom center`
- bridge (slot 5): `max-width: 75vw`
- statue (slot 6): `max-width: 25vw`
- At `min-aspect-ratio: 7/5` (landscape): all imgs capped at `max-height: 45vh`

**`.hero-parallax`** is `position: absolute; top: 0; left: 0; right: 0; height: 100vh` — fixed to viewport height so images at `bottom: 0` always sit at the viewport bottom regardless of how tall the hero grows.

**Hero text clearance:** `.hero` uses `padding-bottom: min(40vh, calc(100vh - 28rem))` to push the centered text above the skyline. At `min-aspect-ratio: 7/5` this overrides to `50vh` and hero-names switches to `clamp(2rem, 5vh, 7rem)` to keep text compact on short wide screens.

## Updating Content

**Add a photo or video to the carousel:** Drop the file into `pics/`, then run `node generate-manifest.js` to regenerate `pics/manifest.json`. The carousel JS fetches that manifest at runtime and builds all slides dynamically — `index.html` never needs to be touched. Supported formats: `.jpg .jpeg .png .webp .gif .avif .mp4 .webm`. HEIC and MOV files are skipped (the script prints conversion commands for them).

**Add a registry item:** Copy a `<div class="registry-item">` block in the Registry section. Update the store name, description, and `href` on the `.btn-outline` link. See the HTML comment above the list for instructions.

**Add a hotel:** Copy the commented hotel card template in the Hotels section. There are 4 hotels currently; The Roxy is `.hotel-featured` (spans full width, has gold border and "Recommended" badge).

**Update honeymoon fund links:** Replace `href="#"` on the Venmo/PayPal `.fund-btn` anchors. For Zelle, update the `<small>` tag text inside `.fund-zelle`.

**Venue addresses:** Maxwell Tribeca's address is currently `Tribeca, New York, NY` — update once confirmed.

**RSVP form:** Posts to a Google Apps Script endpoint via `fetch` with `mode: 'no-cors'`. The Apps Script URL is hardcoded in `script.js` (`initRsvp` IIFE). Fields sent are `name`, `attending` (Yes/No), and `notes`. The Apps Script `doPost(e)` should read `e.parameter.name`, `e.parameter.attending`, `e.parameter.notes`. Because of no-cors, the success state is shown optimistically — the response cannot be read from the browser.
