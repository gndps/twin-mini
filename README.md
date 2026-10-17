# Twin Mini

**Live:** https://twin-mini.vercel.app

Instax-style framed prints from a **Canon SELPHY CP1500** (or any 4×6 / postcard photo printer).

Add one or two photos → get one print-ready JPEG: two Instax-style frames, each filling half of the sheet. Print it from the SELPHY app and cut down the middle.

Everything runs in the browser. Photos are never uploaded; settings and caption templates are saved in the browser's local storage.

## Features

- **Two Minis or One Wide** (main screen). Two Minis splits the sheet into two Instax-style cards that you cut down the middle. One Wide fills the sheet with a single frame, in landscape or portrait (portrait files come out upright and the SELPHY app turns them onto the paper).
- **Photo size & position.** A sheet with a large single-photo preview and three sliders: **Width** (grows evenly on both sides), **Height** (grows downward, top border stays put) and **Top border**. Shape presets (Instax Mini 46×62, Square for Instax Square / Polaroid, 4:5, 3:4, 2:3 for 35 mm / ZINK, 5:7, 9:16) keep their shape as you change the width; dragging Height makes it a custom shape. Always centred left to right, so Two Minis is still a single straight cut. Landscape One Wide shows the shape rotated, with a switch to turn it back. Two Minis and One Wide remember their own settings.
- **CP1500 paper only**, chosen by Canon set name in Advanced: RP-108 (default), KP-108IN, RP-54, KP-36IP (postcard), KL-36IP (L size), KC-36IP and KC-18IF (card size), KC-18IS (square label).
- **Best possible file.** Always a lossless PNG at the resolution of your sharpest photo (no fixed cap, only the browser's canvas limit), with the dpi written into the file.
- **Date.** One date per print, switched on or off on its own, separate from the captions. Show the date or date & time, and compose the format: order (Y M D / D M Y / M D Y), month (10 / Oct / October), year (2026 / '26 / none), separator, weekday (none / Sat / Saturday), 24-hour or 12-hour AM/PM, seconds. The timestamp comes from the photo (EXIF capture time, else file time) or *now*.
- **Captions.** Any number of text captions on any edge with their own font, size, alignment, colour and distance from the photo (closer, further, or overlapping it); each photo can have its own text. When the photo is resized, a caption pulled toward the photo keeps its gap to the photo, one pushed away keeps its gap to the paper edge, and a centred one stays centred. 37 free fonts in six styles.
- **Templates.** Built-in templates, your own (saved on the device until you delete them), and site templates. Any template can be copied as text and imported again.
- **Cut guide.** Optional: short, sparse hairline dashes evenly spaced down the whole centre line, nothing else.
- **Orientation.** EXIF orientation is honoured; each photo can be turned left/right or flipped 180° (rotation only, never mirrored), panned and zoomed.
- **Phone first.** Large touch targets, bottom sheets, full-screen crop editor with pinch-to-zoom, share straight to the SELPHY app.

## Shipping templates with the site

In the app, open **Captions → Templates → Copy** on a template (or *Copy all my templates*). Paste the text into `app/templates.json`:

```json
{
  "templates": [
    { "twinmini": "caption-template", "version": 2, "name": "Retro stamp",
      "captions": [],
      "date": { "on": true, "font": "VT323", "size": 4.4, "edge": "bottom", "align": "end", "color": "stamp",
                "fmt": { "year": "short", "sep": " " } } }
  ]
}
```

A single exported template, an array of them, or `{ "templates": [...] }` all work, both here and in the app's Import box. Push, and every visitor sees them as chips after the built-in ones.

- `captions`: text captions with `font` (any font in the picker), `size` (mm), `edge` (`bottom`/`top`/`left`/`right`), `align` (`start`/`center`/`end`), `color` (`auto`/`ink`/`grey`/`stamp`/`navy`/`red`/`white`), `shift` (mm from centred, −15 … 15; negative = toward/over the photo), `ref` (border thickness in mm when the shift was set; anchors the caption), and `same` + `text`, or `texts` (one per photo).
- `date`: `on`, `source` (`photo`/`now`), the same style fields, and `fmt`: `show` (`date`/`datetime`), `order` (`ymd`/`dmy`/`mdy`), `month` (`num`/`short`/`long`), `year` (`full`/`short`/`none`), `sep` (`.` `/` `-` or space), `weekday` (`none`/`short`/`long`), `clock` (`24`/`12`), `seconds` (`true`/`false`).

## Develop

No build step, no dependencies.

```bash
npm run dev     # serves app/ at http://localhost:5173
npm test        # geometry + dpi-metadata unit tests (node --test)
```

## Deploy

Static site in `app/`. `vercel.json` (Vercel) and `netlify.toml` (Netlify) both publish that folder as-is; pushes to `main` deploy through the Vercel Git integration, and GitHub Actions runs the tests.
