import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { create } from 'zustand';
import type { GymBandGym } from './GymBand';

/**
 * Page chrome: what a page tells the shell about its header. Extracted from
 * ui.tsx (which re-exports everything here, so no import site moved) so the
 * shell package can own it. Pages describe their top bar (title, back,
 * actions) and optional desktop right rail; the shell renders it. Kept in an
 * external store so a page re-render never loops through the shell.
 */
export type PageChrome = {
  path: string;
  title?: string;
  /** Rendered in place of `title` in the phone top bar; `title` still names the document. */
  titleNode?: ReactNode;
  subtitle?: string;
  /** `true` = history back with a sensible fallback; a string = explicit target. */
  back?: boolean | string;
  actions?: ReactNode;
  rail?: ReactNode | null;
  hideTopBar?: boolean;
  hideSectionTabs?: boolean;
  hideBottomNav?: boolean;
  /** Use the full content width (no feed max-width). */
  wide?: boolean;
  /**
   * @deprecated The shell no longer renders a band above <main>; the gym is a
   * <GymHeader> the page places itself. Still typed so pages that have not yet
   * dropped their `band={{…}}` compile; the shell ignores what they send.
   */
  band?: PageBand;
};

/**
 * @deprecated What a page used to declare about the shell band. Kept as a type
 * only until every page has removed its `band` prop.
 */
export type PageBand = {
  variant?: 'full' | 'hub';
  /** Overrides the band title; defaults to `title`. */
  bandTitle?: string;
  context?: string;
  figure?: number | null;
  figureLabel?: string;
  figureUnit?: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  /** Rendered instead of the figure block when `figure` is falsy. */
  children?: ReactNode;
  /** Gym-scoped tabs rendered on the band itself. */
  tabs?: ReactNode;
  /** Page-supplied gym; when omitted the shell uses the viewer's home gym. */
  gym?: GymBandGym | null;
};

type PageChromeState = { chrome: PageChrome | null; set: (c: PageChrome | null) => void };
export const usePageChromeStore = create<PageChromeState>((set) => ({
  chrome: null,
  set: (chrome) => set({ chrome }),
}));

export function usePageChrome(chrome: Omit<PageChrome, 'path'>) {
  const { pathname } = useLocation();
  const set = usePageChromeStore((s) => s.set);
  useEffect(() => {
    set({ ...chrome, path: pathname });
    if (chrome.title) document.title = `${chrome.title} · Vybe`;
  });
  useEffect(() => () => { if (usePageChromeStore.getState().chrome?.path === pathname) set(null); }, [pathname, set]);
}

/**
 * The one page-title treatment. On phones the title lives in the shell's top
 * bar; on desktop it renders inline here. Pages never render their own h1.
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
  band,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  back?: boolean | string;
  actions?: ReactNode;
  /** Compact actions for the mobile top bar when the desktop set is too wide. */
  mobileActions?: ReactNode;
  rail?: ReactNode | null;
  wide?: boolean;
  hideSectionTabs?: boolean;
  /** @deprecated Ignored by the shell; see PageChrome.band. */
  band?: PageBand;
  className?: string;
  children?: ReactNode;
}) {
  // `mobileActions={null}` means "nothing in the top bar"; only undefined falls back to the desktop set.
  usePageChrome({ title, subtitle, back, actions: mobileActions === undefined ? actions : mobileActions, rail, wide, hideSectionTabs, band });
  return (
    <header className={['mb-6 hidden items-end justify-between gap-4 lg:flex', className].filter(Boolean).join(' ')}>
      <div className="min-w-0">
        <h1 className="type-heading truncate text-2xl text-text-1">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-text-2">{subtitle}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </header>
  );
}
