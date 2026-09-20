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
"Pick your gym and Vybe fills with the people who train there.", one primary (`--brand`) CTA to `/gyms`
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

## Palette (Instagram register, P8)

The app reads as an Instagram-register product with a navy gym band: Instagram's neutrals,
Instagram blue for the one action on a screen and for links, the yellow→pink→purple gradient for
story rings, and the Vybe mint kept for exactly two things — the logo mark (`--mark`) and the band's
cover art. Every component consumes the semantic names below; only the values changed, so the
admin console's rebinding and every page follow without edits. Instagram's own values are used
wherever they pass WCAG AA; where they miss, the nearest passing neighbour is used and the reason
sits beside the token in `styles.css`. All ratios were computed, not eyeballed.

| token | light | dark | note |
| --- | --- | --- | --- |
| `--bg` | `#ffffff` | `#000000` | Instagram page white / black |
| `--surface-1/2/3` | `#ffffff` / `#fafafa` / `#efefef` | `#1a1a1a` / `#2a2a2a` / `#373737` | dark steps are each 1.21:1 over the level below; Instagram's `#121212` is 1.12:1 over black, so each level is the nearest grey that clears the ≥1.2:1 rule |
| `--line` / `--line-strong` | `#dbdbdb` / `#c7c7c7` | `rgba(255,255,255,.1)` / `.18` | dark hairlines are white-alpha so one value reads on all four levels |
| `--control-border` | `#919191` | `#737373` | Instagram's `#a8a8a8` / `#555555` are 2.28:1 / 1.93:1 on the field; these are 3.02:1 / 3.03:1 |
| `--text-1` | `#000000` | `#f5f5f5` | |
| `--text-2` | `#666666` | `#a8a8a8` | Instagram's light `#737373` is 4.12:1 on surface-3; `#666666` is 4.99:1 |
| `--text-3` | `#6c6c6c` | `#a0a0a0` | Instagram's `#8e8e8e` is 2.85:1 / 3.63:1 on surface-3; these are 4.57:1 / 4.50:1 |
| `--brand` | `#0077d9` | `#0077d9` | the action blue. Instagram's `#0095f6` is 3.17:1 under a white label; `#0077d9` is 4.53:1 with `--on-brand #ffffff`, 3.51:1 on the navy band. One value in both themes so the band's CTA (always dark-scoped) matches the page's |
| `--brand-hover` | `#0095f6` | `#0095f6` | the true Instagram blue, on hover/active |
| `--brand-soft` / `--brand-text` | `#e7f3ff` / `#00376b` | `rgba(0,149,246,.16)` / `#e0f1ff` | link blue, 11.9:1 on white |
| `--focus` | `#0077d9` | `#0095f6` | 4.53:1 on white, 6.63:1 on black |
| `--success` | `#137a3f` | `#3ddc84` | left the mint family (5.41:1 on white, 4.76:1 on its soft) |
| `--accent` | `#ff7a45` | `#ff7a45` | ember stays; it harmonises with the gradient's orange |
| `--mark` | `#00b08e` | `#00d4aa` | the Vybe mint. `Brand.tsx` and the legal shell only |
| `--mark-on-navy` | `#00d4aa` | `#00d4aa` | the band's pin, live dot and context link |
| `--ig-gradient` / `--story-ring` | `linear-gradient(45deg, #f9ce34, #ee2a7b 50%, #6228d7)` | same | `.story-ring`, `.ig-gradient-text` |
| `--radius-sm` | `8px` | `8px` | Instagram's button and field radius |
| `--shadow-1` | `0 0 0 1px rgba(0,0,0,.05), 0 1px 2px rgba(0,0,0,.04)` | unchanged | nearly flat; the 5 % ring is the card's edge on page white |

Utilities: `.feed-rule` (a 1 px `--line` bottom rule between feed items — Instagram separates,
it does not box), `.story-ring` (2 px gradient ring, 2 px surface gap, wrap the avatar) and
`.ig-gradient-text` (`background-clip: text`, for the rare highlight). Tailwind bindings:
`text-mark`, `bg-mark`, `border-mark`, `text-mark-on-navy`.

What keeps mint: `Brand.tsx` (`text-mark`, never `text-brand`), the legal shell's brand
(`var(--mark)`), and inside `.gym-band` the cover art (`--cover-art`, navy → mint), the kicker
pin, the live dot and the "Find your gym" link glyph (`--mark-on-navy`). `--identity-1` moved from
mint/navy to Instagram pink/navy so generated avatars stop carrying the old brand colour. The band
collapses to `--band-bg` (navy-900) rather than the page's `--surface-1`, so the bar stays navy on
both themes.

## Token additions and changes (`src/styles.css`)

- Dark depth: `--surface-1 #1a1a1a`, `--surface-2 #2a2a2a`, `--surface-3 #373737` (each ≥1.2:1
  over the one below, from `--bg #000000`). `--text-2 #a8a8a8`, `--text-3 #a0a0a0` (4.50:1 on
  surface-3), `--control-border #737373` (3.03:1 on surface-2). See Palette above.
- `--card-border-light`: `transparent` in light (tonal card: surface-1 + `--shadow-1`), `var(--line)`
  in dark and in `.admin-console`. `.card` reads it. Light `--shadow-1` is a 5 % ring plus a 1 px drop.
- Band: `--band-h-full --band-h-hub --band-bar-h --band-ink --band-ink-2 --band-ink-3 --band-scrim
  --band-scrim-h --band-chip --band-chip-line --band-ring --band-geo --band-geo-2 --cover-art`.
- Identity: `--identity-1..5` gradient pairs (pink/navy, lilac/navy, sky/navy, sand/ember,
  navy/navy) with `--identity-N-ink`; `identityStyle(seed)` in `ui.tsx` picks one by hash.
  `Avatar` and `PlaceImage` use it — the grey-initials tile is gone.
- No token was renamed or removed; `styles.admin.css` rebinds the same names.

## One primary control per screen

`--brand` (Instagram blue) is for the one action that matters on the screen: the band's primary
action, or the page's, never both, and never a second blue button in a card. Secondary actions are
`secondary` / `quiet`; progress and live state may use `--brand` as colour, not as a control. The
mint is not an action colour any more: it is `--mark`, for the logo and the band only.
Empty states take one primary action and one quiet one; hub empties pick an illustration with
`<EmptyState family="train|fuel|body|community|social">`.
