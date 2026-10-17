# Twin Mini

**Live:** https://twin-mini.vercel.app

Instax-style framed prints from a **Canon SELPHY CP1500** (or any 4×6 / postcard photo printer).

Add one or two photos → get a single print-ready sheet with two Instax Mini frames (or one Instax Wide frame) laid out on a 148 × 100 mm SELPHY postcard. Print borderless, cut down the middle, trim at the corner ticks.

Everything runs in the browser. Photos are never uploaded.

## Features

- **Half sheet by default.** Every session opens on two Mini-style frames that each fill half of the postcard, so the only cut is down the middle. The photo window keeps the Instax 46 : 62 shape and sits inside what survives the SELPHY's ~2 mm borderless trim, so all four borders come out even; the frame colour bleeds to the paper edge.
- **Minimal by design.** The main screen holds only photos, frame colour and caption. Format, frame size (True Mini 54 × 86 mm, Large, Compact 2 × 3 in, Instax Wide, Custom), caption font, paper, cut guides, resolution and file type live in **Advanced**.
- **Phone first.** Large labelled touch targets, bottom sheets, a full-screen crop editor with pinch-to-zoom, a sticky Create button, and Share-to-SELPHY-app on phones.
- **Full resolution.** Photos are cropped from the original pixels, never stretched. *Auto* output dpi matches your sharpest photo (300–1200 dpi, capped to the browser's canvas limit), and the dpi is written into the PNG (`pHYs`) / JPEG (JFIF) so the file opens at its true size.
- **Orientation.** EXIF orientation from phone photos is honoured; each photo can be turned left/right or flipped 180° (rotation only, never mirrored).
- **Cut guides.** Optional hairline (≈ 0.09 mm, one printer dot) dashed centre line and corner ticks in light grey; switching them off removes them from the preview and the file.

## Develop

No build step, no dependencies.

```bash
npm run dev     # serves app/ at http://localhost:5173
npm test        # geometry + dpi-metadata unit tests (node --test)
```

## Deploy

Static site in `app/`. `vercel.json` (Vercel) and `netlify.toml` (Netlify) both publish that folder as-is; pushes to `main` deploy through the Vercel Git integration, and GitHub Actions runs the tests.
