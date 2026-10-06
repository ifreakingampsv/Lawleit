# 11: Installable app (PWA) — Lawleit on a phone's home screen

**What to build:** The existing SPA becomes installable: a web manifest (name, colors,
icons), an SVG app icon, and the meta tags browsers need, so "Add to Home screen" /
"Install" works on Android and desktop with a proper standalone window instead of a
browser tab. No service worker this slice (offline support is a later decision) — the
manifest declares display/cache behavior only where free. Marketing pages keep their
own favicon behavior; the manifest is app-wide but harmless there.

**Blocked by:** None.

**Status:** ready-for-agent

- [x] `manifest.webmanifest` served from the app (name Lawleit, standalone display, brand colors, maskable SVG icon) + linked from `index.html` with theme-color
- [x] `npm run build` emits it and the SPA-fallback script leaves it alone (a static asset, not a route — `dist/manifest.webmanifest` + icons verified present, dev server answers 200)
- [x] Build clean; hand-check: the manifest is reachable on the dev server and the browser offers install
