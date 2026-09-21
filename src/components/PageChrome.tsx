import { useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { create } from 'zustand';

/**
 * Page chrome: what a page tells the shell about its header.
 *
 * The shell owns the header. Its title resolves route → page-published →
 * "Vybe" on the same frame as the route, so a page never has to publish
 * anything for the bar to be right. What a page publishes here are extras: a
 * live title (`titleNode`), a subtitle, the back target, actions, the desktop
 * rail and the layout flags. Publishing happens in a layout effect, so the
 * extras are in the store before the browser paints the new route — no frame
 * with a bare bar, and no reflow when they land, because the bar's height is
 * fixed and the swap is text-only.
 *
 * The store is external (zustand) and consumers select single fields. A page
 * re-render republishes a fresh object every time (`actions` and `titleNode`
 * are fresh elements, so nothing could compare them equal), and that must
 * re-render only the header: the shell reads primitives — the title, the
 * flags — and only the header subscribes to the element-valued fields.
 */
export type PageChrome = {
  /** The pathname the page published for; the shell ignores chrome from any other path. */
  path: string;
  /** Names the page: the h1 text and the document title. Falls back to the route table's title. */
  title?: string;
  /** Rendered in place of `title` inside the h1 (Messages: avatar + name); `title` still names the document. */
  titleNode?: ReactNode;
  /** A second, 12 px line under the title, inside the same fixed-height bar. */
  subtitle?: ReactNode;
  /** `true` = history back with the route's parent as fallback; a string = explicit target; unset = the route decides. */
  back?: boolean | string;
  /** Trailing controls. Desktop always; phones too unless `mobileActions` says otherwise. */
  actions?: ReactNode;
  /** Trailing controls on phones when the desktop set is too wide: `null` = none, `undefined` = fall back to `actions`. */
  mobileActions?: ReactNode | null;
  /** The desktop right rail: a node replaces the route's default rail, `null` removes it, `undefined` keeps the default. */
  rail?: ReactNode | null;
  /** Use the full content width (no feed max-width). */
  wide?: boolean;
  /** No hub section tabs under the bar (gym pages, live rooms, sheet routes, Messages). */
  hideSectionTabs?: boolean;
  /** No phone bottom tabs (Messages: the composer needs the bottom edge). */
  hideBottomNav?: boolean;
};

/**
 * @deprecated The shell draws no band; the gym is a <GymHeader> the page places
 * itself. Kept as a type only so a page that still passes `band={{…}}` to
 * PageHeader compiles until its owner removes the prop; delete with that prop.
 */
export type PageBand = Record<string, unknown>;

type PageChromeState = { chrome: PageChrome | null; set: (c: PageChrome | null) => void };
export const usePageChromeStore = create<PageChromeState>((set) => ({
  chrome: null,
  set: (chrome) => set({ chrome }),
}));

/**
 * One field of the chrome published for `path`, or undefined when the store
 * holds another path's chrome (or `path` is null: the shell is showing a
 * destination whose page has not rendered yet, so nothing published counts).
 * Selecting a single field keeps a subscriber's re-renders to changes of that
 * field alone.
 */
export function usePageChromeField<T>(path: string | null, pick: (chrome: PageChrome) => T): T | undefined {
  return usePageChromeStore((s) => (path !== null && s.chrome !== null && s.chrome.path === path ? pick(s.chrome) : undefined));
}

export function usePageChrome(chrome: Omit<PageChrome, 'path'>) {
  const { pathname } = useLocation();
  const set = usePageChromeStore((s) => s.set);
  // Layout effects on purpose: the store is written before paint and the
  // header's synchronous re-render lands in the same frame as the route. The
  // cleanup is a layout effect too, so a page that unmounts can never wipe
  // the chrome its successor has just published.
  useLayoutEffect(() => {
    set({ ...chrome, path: pathname });
  });
  useLayoutEffect(() => () => {
    if (usePageChromeStore.getState().chrome?.path === pathname) set(null);
  }, [pathname, set]);
}

/**
 * The one page-title treatment: a page declares its title, actions and flags
 * here and the shell header draws them — on phones and on desktop, one
 * level-one heading per page. This renders nothing itself.
 */
export function PageHeader({
  title,
  subtitle,
  back,
  actions,
  mobileActions,
  rail,
  wide,
  hideSectionTabs,
  hideBottomNav,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: boolean | string;
  actions?: ReactNode;
  /** Compact actions for the phone bar when the desktop set is too wide; `null` = none there. */
  mobileActions?: ReactNode | null;
  rail?: ReactNode | null;
  wide?: boolean;
  hideSectionTabs?: boolean;
  hideBottomNav?: boolean;
  /** @deprecated Ignored: the shell draws no band. Remove the prop; see PageBand. */
  band?: PageBand;
  /** @deprecated Ignored: the header is the shell's. */
  className?: string;
}) {
  usePageChrome({ title, subtitle, back, actions, mobileActions, rail, wide, hideSectionTabs, hideBottomNav });
  return null;
}
