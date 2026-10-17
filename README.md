# Twin Mini

**Live:** https://twin-mini.vercel.app

Instax-style framed prints from a **Canon SELPHY CP1500** (or any 4×6 / postcard photo printer).

Add one or two photos → get a single print-ready sheet with two Instax Mini frames (or one Instax Wide frame) laid out on a 148 × 100 mm SELPHY postcard. Print borderless, cut down the middle, trim at the corner ticks.

Everything runs in the browser. Photos are never uploaded.

## Features

- **Real Instax geometry.** True Mini = 54 × 86 mm card with a 46 × 62 mm photo (4 mm sides, 6 mm top, 18 mm chin). Also Large (+10 %), Compact (2 × 3 in), Half sheet (cut the middle only), Instax Wide, and Custom margins.
- **Full resolution.** Photos are cropped from the original pixels (never re-compressed or stretched). *Auto* output dpi matches your sharpest photo (300–1200 dpi, capped to the browser's canvas limit), so the printer does the only resample. The dpi is written into the PNG (`pHYs`) / JPEG (JFIF) so the file opens at its true physical size.
- **Orientation.** EXIF orientation from phone photos is honoured. Each photo can be rotated left/right or turned 180° (rotation only, never mirrored), panned, and zoomed.
- **Cut guides.** Optional hairline (≈ 0.09 mm, one printer dot) dashed centre line and corner ticks in light grey. Toggle off and they disappear from both the preview and the file.
- Frame colours, optional handwritten/serif/sans caption on the chin, Postcard or 4 × 6 in paper, PNG or JPEG, share sheet on mobile.

## Develop

No build step, no dependencies.

```bash
npm run dev     # serves app/ at http://localhost:5173
npm test        # geometry + dpi-metadata unit tests (node --test)
```

## Deploy

Static site in `app/`. `vercel.json` (Vercel) and `netlify.toml` (Netlify) both publish that folder as-is; pushes to `main` deploy through the Vercel Git integration, and GitHub Actions runs the tests.
