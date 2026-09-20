# In flight: web shell rebuild (Instagram register) — started 2026-09-20 ~23:00Z

**Please do not push UI changes to `vybe-web-app` `main` or release the web app until this note is
removed.** A coordinated rebuild is in progress in six branches (`ig-0-foundation` … `ig-5-chrome`)
that rewrites `src/components/Layout.tsx`, `ui.tsx`, `GymBand.tsx`, `styles.css`, `App.tsx`,
`lib/homeGym.ts` and most of `src/pages/**`. Anything landed on `main` meanwhile will be overwritten
at integration or cause conflicts.

What it does: removes the gym band from every hub (it becomes a compact Instagram-style header on
Home and a profile header on gym pages), moves the page title into a shell-owned header so route
changes stop flashing, restores card edges, unifies to one blue accent, and fixes the layout-shift
and press-feedback defects. Spec: Charlie's session plan file; contact the `vybe-web-redesign-concepts`
Claude session on the MacBook, or Charlie.

The 22:37Z "UI polish sweep" (`bf67e4e`) is the base for this work; its tab labels and profile
clipping fix are kept, its band compaction is superseded.
