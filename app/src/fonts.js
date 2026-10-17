// Caption font catalogue: free Google Fonts, grouped by style, loaded on demand.

export const FONT_GROUPS = [
  { id: 'hand', label: 'Handwritten', fonts: ['Caveat', 'Kalam', 'Gochi Hand', 'Indie Flower', 'Shadows Into Light', 'Reenie Beanie', 'Homemade Apple', 'Nanum Pen Script', 'Patrick Hand'] },
  { id: 'script', label: 'Script', fonts: ['Dancing Script', 'Great Vibes', 'Sacramento', 'Parisienne', 'Allura', 'Pacifico'] },
  { id: 'serif', label: 'Serif', fonts: ['Fraunces', 'Playfair Display', 'Cormorant Garamond', 'DM Serif Display', 'Libre Baskerville', 'Lora'] },
  { id: 'sans', label: 'Sans', fonts: ['Inter', 'DM Sans', 'Montserrat', 'Josefin Sans', 'Quicksand', 'Space Grotesk'] },
  { id: 'mono', label: 'Typewriter', fonts: ['Special Elite', 'Courier Prime', 'IBM Plex Mono', 'Space Mono', 'VT323'] },
  { id: 'display', label: 'Display', fonts: ['Abril Fatface', 'Bebas Neue', 'Righteous', 'Lobster', 'Monoton'] },
];

const FALLBACK = { hand: 'cursive', script: 'cursive', serif: 'serif', sans: 'sans-serif', mono: 'monospace', display: 'sans-serif' };
const groupOf = new Map(FONT_GROUPS.flatMap((g) => g.fonts.map((f) => [f, g.id])));

export const fontCss = (family) => `"${family}", ${FALLBACK[groupOf.get(family)] || 'sans-serif'}`;
export const isKnownFont = (family) => groupOf.has(family);

const requested = new Set();

/** Inject the Google Fonts stylesheet for these families (once each) and wait until usable. */
export async function loadFonts(families) {
  const fresh = families.filter((f) => isKnownFont(f) && !requested.has(f));
  if (fresh.length && typeof document !== 'undefined') {
    fresh.forEach((f) => requested.add(f));
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${fresh.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}`).join('&')}&display=swap`;
    document.head.append(link);
    await new Promise((res) => { link.onload = res; link.onerror = res; });
  }
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all(families.map((f) => document.fonts.load(`40px "${f}"`).catch(() => {})));
}
