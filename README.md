# Twin Mini

**Live:** https://twin-mini.vercel.app

Instax-style framed prints from a **Canon SELPHY CP1500** (or any 4×6 / postcard photo printer).

Add one or two photos → get one print-ready JPEG: two Instax-style frames, each filling half of the sheet. Print it from the SELPHY app and cut down the middle.

Everything runs in the browser. Photos are never uploaded; settings and caption templates are saved in the browser's local storage.

## Features

- **Two Minis or One Wide** (main screen). Two Minis splits the sheet into two Instax-style cards that you cut down the middle. One Wide fills the sheet with a single frame, in landscape or portrait (portrait files come out upright and the SELPHY app turns them onto the paper).
- **Photo size & position.** Pick the photo shape from instant-camera film formats (Instax Mini 46×62, Square 62×62 for Instax Square / Polaroid / Polaroid Go, Instax Wide 99×62, 2×3 ZINK for Kodak Printomatic / Smile / Polaroid Snap), then scale it (shape stays fixed) and move it up or down. It always stays centred left to right, so Two Minis is still a single straight cut.
- **CP1500 paper only**, chosen by Canon set name in Advanced: RP-108 (default), KP-108IN, RP-54, KP-36IP (postcard), KL-36IP (L size), KC-36IP and KC-18IF (card size), KC-18IS (square label).
- **Best possible file.** Always a maximum-quality JPEG at the resolution of your sharpest photo (no fixed cap, only the browser's canvas limit), with the dpi written into the file.
- **Captions.** The photo's own date (EXIF capture date, else file date) is added by default. Add any number of text or date captions on any edge with their own font, size, alignment and colour; each photo can have its own text. 37 free fonts in six styles.
- **Templates.** Built-in templates, your own (saved on the device until you delete them), and site templates. Any template can be copied as text and imported again.
- **Cut guide.** Optional: a few short, sparse hairline dashes at the top and bottom of the centre line, nothing else.
- **Orientation.** EXIF orientation is honoured; each photo can be turned left/right or flipped 180° (rotation only, never mirrored), panned and zoomed.
- **Phone first.** Large touch targets, bottom sheets, full-screen crop editor with pinch-to-zoom, share straight to the SELPHY app.

## Shipping templates with the site

In the app, open **Captions → Templates → Copy** on a template (or *Copy all my templates*). Paste the text into `app/templates.json`:

```json
{
  "templates": [
    { "twinmini": "caption-template", "version": 1, "name": "Retro stamp",
      "captions": [ { "kind": "date", "font": "VT323", "size": 4.4, "edge": "bottom", "align": "end", "color": "stamp", "dateFormat": "stamp" } ] }
  ]
}
```

A single exported template, an array of them, or `{ "templates": [...] }` all work, both here and in the app's Import box. Push, and every visitor sees them as chips after the built-in ones. Caption fields: `kind` (`date`/`text`), `font` (any font in the picker), `size` (mm), `edge` (`bottom`/`top`/`left`/`right`), `align` (`start`/`center`/`end`), `color` (`auto`/`ink`/`grey`/`stamp`/`navy`/`red`/`white`), `dateFormat` (`dots`/`stamp`/`dmy`/`mdy`/`slash`/`month`), and for text `same` + `text`, or `texts` per photo.

## Develop

No build step, no dependencies.

```bash
npm run dev     # serves app/ at http://localhost:5173
npm test        # geometry + dpi-metadata unit tests (node --test)
```

## Deploy

Static site in `app/`. `vercel.json` (Vercel) and `netlify.toml` (Netlify) both publish that folder as-is; pushes to `main` deploy through the Vercel Git integration, and GitHub Actions runs the tests.
