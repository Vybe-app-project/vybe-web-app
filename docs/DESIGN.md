# Vybe web — design notes (the Instagram register)

## Thesis

One register, one accent, chrome measured as a budget. White (or black) surfaces, hairlines,
one blue. The gym is an Instagram-style profile header on Home and the gym pages and nothing
anywhere else: every other page wears a slim title bar. Nothing is ever a zero, an empty star row
or a skeleton that resolves to a hole; a missing datum is omitted and its place offers the next
action. Tokens live in `src/styles.css`; `public/legal.css` repeats the ones the static legal pages
need, verbatim (tests/legal-pages checks).

## Palette

| token | light | dark | role |
| --- | --- | --- | --- |
| `--bg` | `#ffffff` | `#000000` | the page |
| `--surface-1/2/3` | `#fff` / `#fafafa` / `#efefef` | `#1a1a1a` / `#2a2a2a` / `#373737` | cards, washes, wells (dark steps ≥1.2:1) |
| `--line` / `--line-strong` | `#dbdbdb` / `#c7c7c7` | white 10 % / 18 % | hairlines: card edges, feed rules, dividers |
| `--text-1/2/3` | `#000` / `#666` / `#6c6c6c` | `#f5f5f5` / `#a8a8a8` / `#a0a0a0` | all ≥4.5:1 on every surface |
| `--brand` (`--brand-hover`) | `#0077d9` (`#0095f6`) | same | **the one interactive accent**: the single primary action on a screen, links, the active tab, the focus ring |
| `--brand-soft` / `--brand-text` | `#e7f3ff` / `#00376b` | blue 16 % / `#e0f1ff` | tints and link text |
| `--success` / `--danger` / `--warning` | `#137a3f` / `#ed4956` / `#d89a1e` | `#3ddc84` / `#ff6b7a` / `#f5b841` | meaning only: a completed state, a liked heart, the unread badge (`CountBadge` is red), an error |
| `--accent` (ember) | `#ff7a45` | same | effort — a PR badge. Never chrome, never a badge count |
| `--mark` | `#00b08e` | `#00d4aa` | the Vybe mint, on the logo (`Brand.tsx`) and nowhere else |
| `--cover-art` | navy → mint | same | the gym-page banner when a gym has no photo, and the signed-out hero |
| `--story-ring` | yellow → pink → purple | same | story rings (`.story-ring`): the one flourish |
| `--identity-1..5` (+`-ink`) | `#efefef` / `#666` | `#2a2a2a` / `#a8a8a8` | generated avatars are one neutral disc with initials; the five slots all bind to it |
| `--card-border-light` | `var(--line)` | `var(--line)` | cards carry a hairline in both themes |
| `--shadow-1` | `0 1px 2px` 4 % | inset + drop | a whisper under thumbs and toasts; cards rely on their edge |
| `--radius-xs/sm/md/lg/xl` | 6 / 8 / 10 / 12 / 16 | same | chips · controls · inner media · cards and dialogs · sheets |

Rules. One blue per screen. Red and green only where they mean something. Mint is the logo.
Ember is a PR. No raw hex in components; no new colour without a token.

## Type

15 px root. The scale is whole pixels — 11 · 12 · 14 · 15 · 16 · 20 · 24 · 28 · 36 (`text-2xs` …
`text-3xl`) — with line heights on the 4 px grid. Six roles carry the hierarchy; use them before
reaching for a size utility:

| role | size / line / weight | where |
| --- | --- | --- |
| `.t-title` | 20 / 24 / 600 | the page title (one `<h1>` per page, drawn by the shell header) |
| `.t-section` | 16 / 20 / 600 | section, card and rail titles (`Section`, `CardHeader`) |
| `.t-body` | 15 / 20 / 400 | body, captions, rows |
| `.t-name` | 15 / 20 / 700 | a username or a gym name, bolder than the body beside it |
| `.t-meta` | 12 / 16 / 400 · `--text-2` | timestamps, counts, the label under a number |
| `.t-metric` | 32–44 / 1 / 700 tabular | the hero metric, ~3× body: the Workouts week strip, Progress. The one place type gets big |

The roles sit in the `components` layer, so a `text-*` utility still overrides one property. The
`type-*` classes only tune Archivo's width axis. `Archivo Fallback` is Arial / Roboto / Segoe UI
drawn at a measured 98 % so nothing reflows when the webfont lands; the Latin file is preloaded.

## Space and surface

Gutter 16 px on phones, 24 px from `lg`; 24 px between sections (`space-y-6`, `--section-gap`),
16 px between siblings (`space-y-4`); everything on the 4 px grid. Feed column 540 px
(`max-w-feed`), sidebar 244 px, rail 300 px.

Hairline or card, consistently: feed items are hairline rows (`feed-rule`); boxed modules are
`<Card>` — surface-1, 1 px `--line`, radius 12 — never a raw `className="card"`. Every async block has
a skeleton of its exact final size, and an empty state never renders before its query resolves.

## Motion

Tiers (Material 3 / NN/g), transform and opacity only, nothing frequent over 320 ms:

| tier | ms | what |
| --- | --- | --- |
| press | 80 (`--duration-press`) | touch: `a, button, [role=button]` dim to 60 % while pressed; `.pressable` adds a 6 % ink wash on hover and 10 % while pressed (rows, tabs, icon buttons, chips) |
| in-screen | 150–250 ease-out | the tab indicator slides on `translateX`/`scaleX`; the segmented thumb slides; dialogs fade + scale .98→1 in 180 (`--duration-in`) / out 140 (`--duration-out`); sheets slide 200; toasts rise 200 / leave 140 |
| route | 200 | `<main>` cross-fades under the view-transition root; the header, sidebar and bottom nav are named (`.vt-header`, `.vt-sidebar`, `.vt-nav`) and hold still |
| flourish | 300 | the like: heart 1 → 1.3 → 1 with the fill (`usePulse`). Nothing else |

Overlays enter on a transition from `@starting-style` and leave on the matching `-out` class
(`.anim-dialog-*`, `.anim-sheet-*`, `.anim-toast-*`): one motion source per panel, so the sheet's
swipe-to-dismiss drag is never fought by a keyframe. Never animate `height`, `top` or `width`.
Reduced motion (OS or the account flag) collapses durations to 1 ms, drops every translate and
scale, and turns route transitions off. `html { scrollbar-gutter: stable; scroll-padding-top }` keeps
sheets from shoving the page and anchors clear of the sticky chrome; `.cv-auto` skips paint for
feed items below the fold.

## The gym (`<GymHeader>`, `src/components/GymHeader.tsx`)

Pure props, no hook: `{ variant, gym: GymBandGym | null, member?, loading?, stats?, action?,
secondary?, banner?, children? }`. Home passes what `useHomeGym()` returns; a gym page passes its
own `bandGymOf()` payload.

- `compact` (Home): a 72 px row — 48 px round crest, `.t-name` name, `.t-meta` "1 member ·
  Bethlehem", one blue text button (Open for a member, Join otherwise, linking to the gym page;
  `action` overrides, `null` removes). Hairline below. No gym: one 48 px "Find your gym" row.
  Never a hero. The skeleton is the same 72 px row.
- `profile` (gym pages): optional 3:1 banner that scrolls away (the photo, else `--cover-art`;
  `banner` opts in) → 88 px crest overlapping it by 24 px, three `Metric`s beside it (posts ·
  members · this week) → `.t-title` name + `.t-body` vicinity (and rating only when a number) →
  two full-width buttons (`action` blue, `secondary` tonal) → `children` for the tab strip. Map
  tile and "training today" belong to the About and Today tabs, not the header.

Honest copy stays in `GymBand.tsx`: `memberCountLabel` ("1 member", never a zero count),
`trainingTodayLine` (never "0 training today"), `NO_GYM_COPY`.

## The zero rule

`hasMetric(v)` — a finite number above zero — guards every number. `StatTile`, `StatStripItem`,
`Ring` and `<Metric>` take `fallback`: the next action, rendered in the number's place when the
value is 0, null or undefined, while the box keeps its geometry. "0 kcal" and "0 g" are holes, not
facts; a metric that is not there is omitted or replaced by what to do next.

## Page chrome

`src/components/PageChrome.tsx` owns `PageChrome`, `usePageChromeStore`, `usePageChrome` and
`PageHeader` (re-exported from `ui.tsx`). A page publishes its title, actions and rail; the shell
renders the one `<h1>`.
