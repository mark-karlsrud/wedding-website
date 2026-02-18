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
- **`script.js`** — Four self-contained IIFEs: nav scroll/mobile toggle, carousel, RSVP form submission, and scroll-reveal animations.

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

## Updating Content

**Add a photo or video to the carousel:** Drop the file into `pics/`, then run `node generate-manifest.js` to regenerate `pics/manifest.json`. The carousel JS fetches that manifest at runtime and builds all slides dynamically — `index.html` never needs to be touched. Supported formats: `.jpg .jpeg .png .webp .gif .avif .mp4 .webm`. HEIC and MOV files are skipped (the script prints conversion commands for them).

**Add a registry item:** Copy a `<div class="registry-item">` block in the Registry section. Update the store name, description, and `href` on the `.btn-outline` link. See the HTML comment above the list for instructions.

**Add a hotel:** Copy the commented hotel card template in the Hotels section. There are 4 hotels currently; The Roxy is `.hotel-featured` (spans full width, has gold border and "Recommended" badge).

**Update honeymoon fund links:** Replace `href="#"` on the Venmo/PayPal `.fund-btn` anchors. For Zelle, update the `<small>` tag text inside `.fund-zelle`.

**Venue addresses:** Maxwell Tribeca's address is currently `Tribeca, New York, NY` — update once confirmed.

**RSVP form:** Posts to a Google Apps Script endpoint via `fetch` with `mode: 'no-cors'`. The Apps Script URL is hardcoded in `script.js` (`initRsvp` IIFE). Fields sent are `name`, `attending` (Yes/No), and `notes`. The Apps Script `doPost(e)` should read `e.parameter.name`, `e.parameter.attending`, `e.parameter.notes`. Because of no-cors, the success state is shown optimistically — the response cannot be read from the browser.
