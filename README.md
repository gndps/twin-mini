# Twin Mini

**Live:** https://twin-mini.vercel.app

Instax-style framed prints from a **Canon SELPHY CP1500** (or any 4×6 / postcard photo printer).

Add one or two photos → get one print-ready JPEG: two Instax-style frames, each filling half of the sheet. Print it from the SELPHY app and cut down the middle.

Everything runs in the browser. Photos are never uploaded; settings and caption templates are saved in the browser's local storage.

## Features

- **One layout: half sheet.** Each half is an Instax-style card: equal side and top borders, a 46 : 62 photo window, and a chin. No margin or bleed settings. The SELPHY app handles printing.
- **CP1500 paper only**, chosen by Canon set name: RP-108 (default), KP-108IN, RP-54, KP-36IP (postcard), KL-36IP (L size), KC-36IP and KC-18IF (card size), KC-18IS (square label).
- **Best possible file.** Always a maximum-quality JPEG at the resolution of your sharpest photo (no fixed cap, only the browser's canvas limit), with the dpi written into the file.
- **Captions.** The photo's own date (EXIF capture date, else file date) is added by default. Add any number of text or date captions on any edge (bottom, top, left, right) with their own font, size, alignment and colour; each photo can have its own text. 37 free fonts in six styles (handwritten, script, serif, sans, typewriter, display).
- **Templates.** Built-in caption templates plus your own, saved on the device until you delete them.
- **Cut guide.** Optional: a few short, sparse hairline dashes at the top and bottom of the centre line, nothing else.
- **Orientation.** EXIF orientation is honoured; each photo can be turned left/right or flipped 180° (rotation only, never mirrored), panned and zoomed.
- **Phone first.** Large touch targets, bottom sheets, full-screen crop editor with pinch-to-zoom, share straight to the SELPHY app.

## Develop

No build step, no dependencies.

```bash
npm run dev     # serves app/ at http://localhost:5173
npm test        # geometry + dpi-metadata unit tests (node --test)
```

## Deploy

Static site in `app/`. `vercel.json` (Vercel) and `netlify.toml` (Netlify) both publish that folder as-is; pushes to `main` deploy through the Vercel Git integration, and GitHub Actions runs the tests.
