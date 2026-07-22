# Static image conventions & placeholders (build_plan/14.7)

Real binary assets are dropped in here later by the owner. Until then we follow
the **placeholder convention**: where an image is needed but not yet available
(dashboard screenshots, social card), the page renders a **labeled box showing
the intended alt text** so the spot is obvious and the alt text is already written.

## Files here

- `logo.svg` — the AI-authored PortQueue mark (also used in the navbar). Lightweight,
  theme-friendly, favicon-derivable. Concept: ordered/aligned queue units flowing
  through a rounded "port" gateway (build_plan/14.5).
- `favicon.svg` — derived from the mark.

## Pending assets (owner to supply)

- `social-card.png` — 1200x630 Open Graph card. Referenced by `themeConfig.image`.
  A missing PNG only affects link-preview cards, not the build.
- Dashboard screenshots for `docs/dashboard.md` — currently rendered as labeled
  alt-text placeholder boxes.

No third-party font/CDN calls are used anywhere; the wordmark uses the system
font stack defined in `src/css/custom.css`.
