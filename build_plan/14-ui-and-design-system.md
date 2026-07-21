# 14 — Shared UI & Design System (`@portqueue/ui`)

A single design system shared by the **docs site** and the **dashboard** so they visibly belong to the same product. This is the raw-plan requirement for a `/packages` UI-only package with a shared theme, using **Ant Design** and the CSS-in-JS solution **recommended by Ant Design**.

## 14.1 Scope & why it exists

- Holds the **theme tokens**, brand assets (incl. the logo — 14.5), and a small set of **shared presentational components/styling primitives** used by both the dashboard (React app) and the docs site (Docusaurus/React).
- Both consumers import from here so a color/spacing/typography change happens in one place and both update. This is what makes "docs and dashboard feel built for the same project" true rather than aspirational.
- **Responsive by design.** The shared tokens include the **breakpoints** and responsive primitives both consumers use, so the docs (file 15) and dashboard (file 12) are **mobile-friendly and fully responsive** consistently. Components ship mobile-first; responsiveness is a design constraint kept in mind from the start, not bolted on.

## 14.1a Modern design language (hard requirement)

Both the **dashboard** and the **docs site must look genuinely modern** — contemporary, polished, and clearly of-2025, not a default AntD/Bootstrap admin template. This is a first-class design goal and the shared tokens exist to enforce it consistently. Encode it in `tokens.ts` and the shared primitives so both surfaces inherit it:

- **Clean, spacious, content-first.** Generous whitespace and a consistent spacing scale (e.g. 4px base), a clear typographic hierarchy with a modern variable/system font stack, comfortable line-heights, and restrained accent color over large flat neutral fields — not dense, boxed-in chrome.
- **Soft depth, not heavy borders.** Prefer **subtle shadows, layering, and generous border-radii** (rounded cards/inputs/buttons) over hard 1px borders — matching the raw-plan "borderless, soft-shadow" search input. Consistent elevation tokens (shadow scale) in `tokens.ts`.
- **Modern surface treatments** where tasteful and performant: soft gradients / mesh accents on hero and empty states, optional subtle glassmorphism (backdrop-blur) on sticky headers/overlays, and a cohesive accent palette. Keep it legible and never at the cost of contrast/accessibility.
- **Purposeful motion.** Smooth, quick micro-interactions and transitions (hover, focus, page/route and theme changes, skeleton→content) via a shared motion/easing token set — subtle, fast, and **respecting `prefers-reduced-motion`**.
- **Polished states.** First-class **skeleton loaders**, empty states with illustration/iconography, and clear focus-visible rings — no jarring layout shift, no bare spinners as the only feedback.
- **Accessible & consistent.** Modern ≠ low-contrast: meet WCAG AA contrast in both light and dark, keyboard-navigable, visible focus. The look is identical across docs and dashboard because it flows from these shared tokens/primitives.

_This design language is normative for files 12 (dashboard) and 15 (docs); their own sections reference back here rather than re-specifying it._

## 14.2 Ant Design + CSS-in-JS choice

- **Component library:** Ant Design (AntD) — used by both dashboard and docs custom components. (Docusaurus itself uses Infima for its base chrome; AntD is used for our custom docs components and the whole dashboard — 14.6 reconciles the two.)
- **CSS-in-JS:** use **`antd-style`** (Ant Design's officially recommended CSS-in-JS library, built on `@ant-design/cssinjs`). It provides `createStyles`, theme-token access, and SSR/static extraction that plays well with static rendering.
  - Note: the base `project-structure` skill discourages CSS-in-JS for app SPAs; the raw plan **explicitly** asks for the AntD-recommended CSS-in-JS here, so this product-specific decision overrides the generic guideline for these packages. Record the rationale in the docs "why" note.
- Theming is driven by AntD's token system via a shared `ConfigProvider` theme object exported from this package.

## 14.3 Package contents

```
packages/ui/src/
  theme/
    tokens.ts            Design tokens: color palette, radii, spacing, shadows, z-index
    light-theme.ts       AntD ConfigProvider theme (light)
    dark-theme.ts        AntD ConfigProvider theme (dark)
    typography.ts        Font stack + the distinctive display font for the wordmark (14.5)
  components/
    Logo.tsx             The brand wordmark/logo component (renders the SVG; size/variant props)
    StatusTag.tsx         JobStatus → colored AntD Tag (single source of state colors, shared by dashboard)
    ThemeSwitcher.tsx    Light/dark/system switcher (14.4)
    Callout.tsx / CodeTabs primitives  Shared doc/dashboard bits where it makes sense
  styles/
    global.css           Minimal resets / CSS variables mirrored from tokens
  assets/
    logo/                SVG logo files (14.5) + favicon derivatives
    images/              Shared imagery + placeholders (14.7)
  index.ts               Barrel
```

- `StatusTag` centralizes the **JobStatus → color** mapping so the dashboard, and any docs example, render states identically (`ACTIVE` cyan, `COMPLETED` green, `FAILED` red, `RETRY` yellow, `STALLED` magenta, `PENDING` default, `CANCELLED/EXPIRED` grey). One source of truth for state colors.
- Publish decision (**settled**): `@portqueue/ui` is **`private: true` and never published to npm**. It is consumed at build time by both the docs site and the dashboard and bundled into each; external users never import it directly. It is excluded from `publish.yml` (file 17).

## 14.4 Theming: light/dark + system preference

- Default: follow the OS/browser preference (`prefers-color-scheme`) on first load.
- Provide a **`ThemeSwitcher`** (used in both docs header and dashboard header) to override.
- The manual override is **reset back to following the system** when the OS theme changes (raw-plan requirement): listen to the `prefers-color-scheme` media-query `change` event and, on a real OS switch, clear the manual override so the app tracks the system again.
- Persist the manual choice (localStorage) until an OS change resets it.

## 14.5 Logo — AI-generated SVG (required)

The raw plan originally said "no logo, the name is the logo." **This is superseded by an explicit later instruction:** the project **must have an AI-generated SVG logo**, used in **both the docs site and the dashboard**.

Requirements:
- **The implementing AI generates an original SVG logo** for PortQueue (a mark and/or a stylized wordmark). It must be:
  - **SVG, hand-authorable and lightweight** (clean paths, no huge embedded rasters), theme-aware (works on light and dark; use `currentColor` or provide light/dark variants).
  - Conceptually on-brand: PortQueue is a database-backed queue — motifs like an ordered set of stacked/aligned elements, a port/gateway, or flowing units are appropriate. Keep it simple, modern, and legible at small sizes (favicon → header).
  - Provided in a few sizes/variants under `packages/ui/src/assets/logo/`: full lockup (mark + wordmark), mark-only (for the favicon and compact headers), and a monochrome variant.
- **Wordmark font:** the name may use a distinctive display font (the raw plan's "different font" idea) defined in `typography.ts`; ship it self-hosted (no third-party font CDN call) or render the wordmark as SVG paths so it's dependency-free and consistent.
- **Usage:** the `Logo` component (with `variant` and `size` props) is placed in the **docs header (left)** and the **dashboard header**, both pulling from this package so they're identical. Favicon derived from the mark.
- If, at implementation time, generating a satisfactory SVG isn't possible, fall back to a **clean SVG wordmark** (the name set in the display font as SVG paths) — still an SVG asset in this package, still shared — and leave a clearly-labeled placeholder note so a designer can drop in a final mark later (14.7 placeholder convention).

## 14.6 Reconciling AntD with Docusaurus

- Docusaurus ships its own theme (Infima) for the standard docs chrome (sidebar, navbar, article layout). We **keep that for the docs frame** and apply our brand via Docusaurus theme customization (CSS variables mapped from our tokens) + swizzled components where needed.
- For **custom docs components** (the per-driver code tabs, callouts, landing-page sections, related-links) we use AntD + `antd-style` wrapped in an AntD `ConfigProvider` using the shared theme, so those bits match the dashboard exactly.
- The shared **tokens** (`tokens.ts`) are the bridge: both the Docusaurus CSS variables and the AntD theme derive from the same values, so colors/spacing line up across the Infima chrome and the AntD components.

## 14.7 Images & placeholders

- Shared images live under `packages/ui/src/assets/images/` (and docs-specific images under the docs workspace `static/`).
- **Placeholder convention:** when an image is needed but not yet available (e.g. a dashboard screenshot in the docs), render a labeled placeholder box showing the intended **alt text**, so the spot is obvious and the alt text is already written. The owner drops the real asset in later. (Raw-plan requirement.)
- Icons: use `@ant-design/icons` (and inline SVGs) generously across docs and dashboard.

## 14.8 Local final-check checklist

- [ ] One shared token set drives both dashboard (AntD theme) and docs (Docusaurus CSS vars).
- [ ] **Modern design language (§14.1a)** encoded in tokens/primitives: spacious content-first layout, soft shadows + rounded surfaces over hard borders, tasteful modern surface/accent treatments, purposeful `prefers-reduced-motion`-aware motion, skeleton/empty/focus states, AA contrast — applied consistently to docs + dashboard.
- [ ] `antd-style` (AntD-recommended CSS-in-JS) is used for custom components; rationale recorded.
- [ ] An **AI-generated SVG logo** exists in `@portqueue/ui`, theme-aware, in full/mark/mono variants, used in **both** docs and dashboard headers, with favicon derived from it.
- [ ] Light/dark + system preference with a switcher; manual override resets on OS theme change.
- [ ] `StatusTag` is the single source of JobStatus colors, shared everywhere.
- [ ] Placeholder convention (alt-text boxes) in place for missing images; no third-party font/CDN calls.
