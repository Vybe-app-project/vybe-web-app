# Vybe web — Gym First design notes

## Thesis

The gym is the social unit. The app opens on the member's home gym — a cover band with the
gym's name, its people and its place — not on a dashboard, and every hub wears a shorter cut
of the same band. With no home gym (every real account on day one, since gyms were purged on
2026-09-20) the band is still the first thing on screen: it invites the member to find one.
Nothing in the band is ever a zero, an empty star row or a skeleton that resolves to a hole;
a missing datum is omitted.

## The band (`<GymBand>`, `src/components/GymBand.tsx`)

Dark in both themes: the section is scoped `.dark` like `AuthShell`, so `--surface-1` inside it
is navy while the page around it stays light. Copy uses `--band-ink` / `--band-ink-2` and sits on
the bottom scrim (`--band-scrim`, lower 200 px), never on bare cover art.

**Cover.** A resolved `photoUrl` (`object-fit: cover`), or `--cover-art` (the token gradient) plus
two soft circles positioned from a hash of `gym.id`, so a gym always looks like itself. A broken
photo falls back to the gradient.

**`variant="full"`** — gym pages and Home. `min-height: var(--band-h-full)` =
`clamp(248px, 30vw + 120px, 360px)`. Bottom-aligned: kicker (pin + "Your gym · city"), the name in
`type-display` at `--text-band`, a meta line (rating only when it is a real number), the member
stack (max 4 + "+N") with its honest label ("128 members" or the caller's `peopleLabel`), the
leaderboard's "N training today" line only when a label arrives, and a map tile (84 / 104 px on
`lg`, `radius-md`, 2 px light ring) linking to OpenStreetMap only when `coords` exist.
Gym-scoped tabs (`tabs`) render on the band; style children with `.gym-band-tab`.

**`variant="hub"`** — every other hub. `min-height: var(--band-h-hub)` =
`clamp(132px, 12vw + 84px, 196px)`. Title (`--text-h1`), one context line ("Your week at …" or
the date), ONE figure in `type-stat` at `--text-figure` drawn only when `figure > 0`, otherwise
`children` (the next action), and the primary `action`.

**No gym (`gym` null/undefined).** Full: kicker "Find your gym", title "Train somewhere?", body
"Pick your gym and Vybe fills with the people who train there.", one mint CTA to `/gyms`
(`action` overrides it). Hub: the hub keeps its title, figure/children and action; when the caller
passes no `context` the line becomes a "Find your gym" link. Same cover, same height.

**Chrome.** `chrome` is the brand / search / inbox / Log row; it is absolutely placed in the top
56 px and rides down through the collapse so it reads as fixed. A centred `text-md` bar title
fades in for the collapsed state.

**Collapse (`useBandCollapse`, `src/lib/gymBand.ts`).** The band is `position: sticky` with
`top: 56px − height`, so its bottom 56 px pin and nothing animates layout. One registered
property, `--band-p` (0 open → 1 bar), drives cover and scrim opacity, the chrome transform and
the fade of main content and tabs. Where `animation-timeline: scroll()` exists CSS owns the
number (`[data-collapse='css']`); otherwise a passive scroll listener batched in
`requestAnimationFrame` writes it (`'js'`). Under `prefers-reduced-motion` or
`<html data-reduce-motion>` there is no animation: the band flips to its bar once scrolled past.
The band must be a child of the scrolling column (sticky is confined to its parent).

## Fluid and container rules

- Type: `--text-h1`, `--text-stat` (+ `--text-stat-sm`), `--text-band`, `--text-figure` are
  `clamp()`s; Tailwind utilities `text-h1 text-stat text-stat-sm text-band text-figure`.
- Space: `--gutter`, `--section-gap` → `p-gutter px-gutter gap-gutter`, `gap-section
  space-y-section`; content width `--content-max` → `max-w-content`.
- Grids reflow by the space they have: `<CardGrid min="22rem">` =
  `repeat(auto-fill, minmax(min(100%, var(--card-min)), 1fr))`. No `sm:grid-cols-2 xl:grid-cols-3`.
- Cards whose internals reflow take `<Card container>` (`container-type: inline-size`) and use
  `@sm:` / `@md:` variants inside.
- 320 px must not break; test 320 / 390 / 768 / 1024 / 1440 / 1920.

## Token additions and changes (`src/styles.css`)

- Dark depth: `--surface-1 #0d2538`, `--surface-2 #16354b`, `--surface-3 #1e435b` (each ≥1.2:1
  over the one below; `--bg` unchanged). `--text-2 #b1c3cc`, `--text-3 #9ab0bc` (4.63:1 on
  surface-3), `--control-border #66838f` (3.17:1 on surface-2).
- `--card-border-light`: `transparent` in light (tonal card: surface-1 + `--shadow-1`), `var(--line)`
  in dark and in `.admin-console`. `.card` reads it. Light `--shadow-1` gained a soft 6 px layer.
- Band: `--band-h-full --band-h-hub --band-bar-h --band-ink --band-ink-2 --band-ink-3 --band-scrim
  --band-scrim-h --band-chip --band-chip-line --band-ring --band-geo --band-geo-2 --cover-art`.
- Identity: `--identity-1..5` gradient pairs (mint/navy, lilac/navy, sky/navy, sand/ember,
  navy/navy) with `--identity-N-ink`; `identityStyle(seed)` in `ui.tsx` picks one by hash.
  `Avatar` and `PlaceImage` use it — the grey-initials tile is gone.
- No token was renamed or removed; `styles.admin.css` rebinds the same names.

## One mint control per screen

`--brand` is for the one action that matters on the screen: the band's primary action, or the
page's, never both, and never a second mint button in a card. Secondary actions are
`secondary` / `quiet`; progress and live state may use mint as colour, not as a control.
Empty states take one primary action and one quiet one; hub empties pick an illustration with
`<EmptyState family="train|fuel|body|community|social">`.
