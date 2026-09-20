import { useEffect, useRef, useState } from 'react';

/**
 * Scroll collapse for <GymBand>. The band is `position: sticky` with a
 * negative top, so as the page scrolls its bottom 56 px stay pinned; every
 * visual change is driven by one number, `--band-p` (0 = open, 1 = the bar),
 * and touches only opacity, transform and colour.
 *
 *  - Where the browser has scroll-driven animations, CSS owns the number:
 *    `[data-collapse='css']` runs a keyframe over `--band-p` on a scroll()
 *    timeline (see the .gym-band rules in styles.css). Butter, no JS per frame.
 *  - Otherwise a passive scroll listener batched in requestAnimationFrame
 *    writes `--band-p` on the element (`[data-collapse='js']`).
 *  - Under prefers-reduced-motion or <html data-reduce-motion> there is no
 *    animation at all: the band flips to its bar once it is scrolled past
 *    (`[data-collapse='none'][data-collapsed='true']` sets --band-p: 1).
 *
 * The hook always keeps React informed through `collapsed` (a boolean, for
 * aria state) and `progress` (quantised to 1/20 so it re-renders at most 20
 * times across a collapse).
 */

export type BandCollapse<T extends HTMLElement = HTMLElement> = {
  ref: React.RefObject<T | null>;
  collapsed: boolean;
  /** 0 (open) .. 1 (bar), in steps of 0.05. */
  progress: number;
};

export const BAND_BAR_HEIGHT = 56;

export function reduceMotionActive(): boolean {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.dataset.reduceMotion === 'true') return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function supportsScrollTimeline(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
  return CSS.supports('animation-timeline: scroll()') && typeof CSS.registerProperty === 'function';
}

/** Nearest ancestor that scrolls vertically, or null for the viewport. */
export function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node && node !== document.body) {
    const { overflowY } = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(overflowY)) return node;
    node = node.parentElement;
  }
  return null;
}

/** How far the band has scrolled above the top of its scroller, as 0..1 of its collapsible height. */
export function collapseProgress(bandTop: number, scrollerTop: number, bandHeight: number, barHeight = BAND_BAR_HEIGHT): number {
  const range = Math.max(1, bandHeight - barHeight);
  return Math.min(1, Math.max(0, (scrollerTop - bandTop) / range));
}

export const quantise = (p: number, steps = 20) => Math.round(p * steps) / steps;

export function useBandCollapse<T extends HTMLElement = HTMLElement>(): BandCollapse<T> {
  const ref = useRef<T | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = reduceMotionActive();
    const mode: 'none' | 'css' | 'js' = reduce ? 'none' : supportsScrollTimeline() ? 'css' : 'js';
    el.dataset.collapse = mode;

    const scroller = scrollParentOf(el);
    const scrollTarget: HTMLElement | Window = scroller ?? window;
    let height = el.offsetHeight;
    let frame = 0;
    let lastCollapsed = false;
    let lastProgress = 0;

    // The band's natural offset inside the scroller, so the CSS timeline range
    // starts where the band starts even when something sits above it.
    const measure = () => {
      height = el.offsetHeight;
      el.style.setProperty('--band-measured', `${height}px`);
      const rect = el.getBoundingClientRect();
      const scrollerTop = scroller ? scroller.getBoundingClientRect().top : 0;
      const scrollTop = scroller ? scroller.scrollTop : window.scrollY;
      // While pinned the rect is not the natural position; only trust it when open.
      if (rect.top - scrollerTop >= 0) el.style.setProperty('--band-start', `${Math.max(0, rect.top - scrollerTop + scrollTop)}px`);
    };

    const update = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const scrollerTop = scroller ? scroller.getBoundingClientRect().top : 0;
      const p = collapseProgress(rect.top, scrollerTop, height);
      const isCollapsed = mode === 'none' ? p >= 0.5 : p >= 0.98;
      if (mode === 'js') el.style.setProperty('--band-p', p.toFixed(3));
      if (isCollapsed !== lastCollapsed) {
        lastCollapsed = isCollapsed;
        el.dataset.collapsed = isCollapsed ? 'true' : 'false';
        setCollapsed(isCollapsed);
      }
      const q = quantise(p);
      if (q !== lastProgress) {
        lastProgress = q;
        setProgress(q);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    measure();
    update();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { measure(); onScroll(); }) : null;
    ro?.observe(el);
    scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      ro?.disconnect();
      scrollTarget.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return { ref, collapsed, progress };
}
