# Twin Mini

**Live:** https://twin-mini.vercel.app

Instax-style framed prints from a **Canon SELPHY CP1500** (or any 4×6 / postcard photo printer).

Add one or two photos, tap a print to decorate it like a story, and get one print-ready PNG: two Instax-style frames, each filling half of the sheet. Print it from the SELPHY app and cut down the middle.

Everything runs in the browser. Photos are never uploaded; edits, photos and themes are saved in the browser.

## Features

- **Edit on the print, like a story.** Tap a print to open it almost full screen. Everything happens on the canvas, the way Instagram Stories works:
  - **Drag, pinch and twist.** One finger moves text, the date, emoji and stickers. Pinching scales them and twisting with two fingers rotates them. They snap to the card centre, the photo's edges and the middle of each border, and rotation snaps to 0°, 90°, 180° and 270°.
  - **Delete and layering.** Drag an element onto the bin that appears at the bottom to delete it. The element you touch comes to the top.
  - **Tap to edit.** Tap empty space to add text. Tap a selected text to retype it in a full-screen text tool with fonts above the keyboard, a colour row, a size slider, alignment and background styles. Tap a selected date to cycle through its styles.
  - **Crop on the canvas.** Pinch or drag the photo itself to crop it.
  - **Mouse and keyboard.** Use the corner handle to scale and rotate, the wheel to resize, Delete to remove, the arrow keys to nudge, ⌘D to duplicate and ⌘Z / ⇧⌘Z to undo and redo.
- **A deck instead of settings.** The editor's bottom deck has Text, Stickers, Date, Layout, Portrait/Landscape, Frame and Photo. Selecting an element swaps in its own tools: Edit or Format, Font, Colour, Background, Align, Size, Duplicate and Delete. The home screen's deck has Two Minis / One Wide, Paper, Cut guide, Swap, Themes and Export.
- **Layout by dragging lines.** **Layout** extends the photo's edges into lines across the print:
  - the sides set the width (it grows evenly on both sides);
  - the top line sets the top border, and snaps to the side border for the Instax look;
  - the bottom line sets the height.

  Shape presets are Instax Mini 46×62, Square, 4:5, 3:4, 2:3, 5:7 and 9:16, plus **Turn shape** and **Reset size**. Text and stickers stay in their part of the print as the layout changes: chin text stays in the chin.
- **Rounded photo corners.** The photo window has the very slight corner rounding of Instax film by default: about 0.23 mm on a Mini's 46 mm side (0.5 % of the short side), measured from high-resolution scans of real Mini and Square prints, since Fujifilm publishes no figure. A **Corners** slider in Layout tunes it from square to well rounded.
- **Every print is independent.** Each print has its own orientation (portrait or landscape, even in Two Minis), layout, frame colour, text, stickers and photo crop. Two Minis and One Wide keep their own prints.
  - In Two Minis, prints facing the same way share one layout by default (**Same on both**, which can be switched off). A portrait and a landscape print always have their own.
  - A landscape print in Two Minis is turned a quarter in its half of the sheet, so it still cuts down the middle.
- **Stickers.** The tray has a date or date & time sticker, text, vector stickers (hearts, stars, sparkles, flowers, sun, moon, washi tapes, a doodled arrow, circle and underline…), emoji (pick from the grid or type any) and your own picture or GIF (printed as a still).
- **Two Minis or One Wide.** Two Minis splits the sheet into two Instax-style cards that you cut down the middle. One Wide fills the sheet with one print; a portrait One Wide file comes out upright and the SELPHY app turns it onto the paper.
- **Paper.** Canon SELPHY CP1500 sets by name: RP-108 (default), KP-108IN, RP-54, KP-36IP (postcard), KL-36IP (L size), KC-36IP and KC-18IF (card size), KC-18IS (square label). Picking one fills in its size, which you can edit into any custom size (40–420 mm per side). Other common printer paper is listed too: 4×6, 5×7, 3.5×5, 4×4, 8×10 in, A6, A5, A4, US Letter.
- **Best possible file.** Always a lossless PNG at the resolution of your sharpest photo (no fixed cap, only the browser's canvas limit), with the dpi written into the file.
- **Date.** On by default in each print's chin, from the photo (EXIF capture time, else file time) or *now*. **Format** composes it: date or date & time, order (Y M D / D M Y / M D Y), month (10 / Oct / October), year (2026 / '26 / none), separator, weekday, 24-hour or 12-hour AM/PM and seconds.
- **Themes.** A theme is the whole document without the photos: both formats, every print's orientation, layout, frame, text, stickers (pictures included) and date, plus paper and cut guide, under a name.
  - Save your own in **Themes**; they stay on the device until you delete them. Site themes and yours appear as chips.
  - **Export** copies the current theme as text or saves it as a `.twinmini.json` file.
  - **? → Import a theme** pastes or opens one, saves it under its name and applies it.
  - Caption templates from earlier versions still import, and your saved settings carry over.
- **Saved as you go.** Edits, photos and pictures are kept in this browser (local storage and IndexedDB), so a reload brings everything back. Nothing is uploaded.

## Shipping themes with the site

In the app, use **Export → Theme → Copy** (or **Themes → Copy all my themes**). Paste the text into `app/templates.json`. A single exported theme, an array of them, or `{ "templates": [...] }` all work, both there and in the app's Import box. Push, and every visitor sees them as chips.

```json
{ "twinmini": "theme", "version": 4, "name": "Retro stamp",
  "sheet": { "format": "two", "paperId": "RP-108", "customPaper": { "w": 148, "h": 100 }, "marks": true, "linked": true },
  "two": [
    { "orientation": "portrait", "color": "cream",
      "layout": { "aspect": "mini", "turn": false, "w": null, "h": null, "top": null, "corner": null },
      "elements": [
        { "type": "date", "x": 0.878, "y": 0.92, "rot": 0, "size": 4.4, "font": "VT323", "color": "#E0662F",
          "align": "right", "bg": "none", "source": "photo", "fmt": { "year": "short", "sep": " " } } ] },
    { "orientation": "portrait", "color": "cream", "layout": { "aspect": "mini" }, "elements": [] } ],
  "one": [ { "orientation": "landscape", "layout": { "aspect": "2x3" }, "elements": [] } ] }
```

- `sheet`: `format` (`two`/`one`), `paperId` (e.g. `RP-108`, `4x6in`, `custom`), `customPaper` `{ "w", "h" }` in mm, `marks` (cut guide), `linked` (prints facing the same way share a layout).
- Each print: `orientation` (`portrait`/`landscape`), `color` (`white`/`cream`/`blush`/`sage`/`sky`/`butter`/`ink`), and `layout`:
  - `aspect`: a shape id, or `custom` with `h` set;
  - `turn`: turns the shape against the card;
  - `w`, `h` and `top`: fractions of the card, where `null` means the default;
  - `corner`: the photo corner radius as a fraction of the window's short side, where `null` means Instax.
- `elements`, drawn in order. Every element has `type`, `x` and `y` (its anchor, as fractions of the card), `rot` (degrees) and `size` (mm: the text height, or the sticker height):
  - `text`: `text`, `font` (any font in the picker), `color` (`auto` or `#rrggbb`), `align` (`left`/`center`/`right`; the anchor is on that side) and `bg` (`none`/`solid`/`soft`).
  - `date`: the same style fields, plus `source` (`photo`/`now`) and `fmt`: `show` (`date`/`datetime`), `order` (`ymd`/`dmy`/`mdy`), `month` (`num`/`short`/`long`), `year` (`full`/`short`/`none`), `sep` (`.` `/` `-` or space), `weekday` (`none`/`short`/`long`), `clock` (`24`/`12`) and `seconds`.
  - `emoji`: `char`.
  - `sticker`: `sticker` (an id from `app/src/stickers.js`) and `color` (`null` keeps its own).
  - `image`: `ratio` (width ÷ height) and `src` (a `data:image/…` URL).
- Older caption templates (`"captions": [...]`, version 1–3) still work. Without a `look` they change only the writing and keep each print's layout.

## Develop

No build step, no dependencies.

```bash
npm run dev     # serves app/ at http://localhost:5173
npm test        # geometry, model, date and dpi-metadata unit tests (node --test)
```

## Deploy

Static site in `app/`. `vercel.json` (Vercel) and `netlify.toml` (Netlify) both publish that folder as-is; pushes to `main` deploy through the Vercel Git integration, and GitHub Actions runs the tests.

## License

Open source under the [MIT License](LICENSE). Contributions welcome.
