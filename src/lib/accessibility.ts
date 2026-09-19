/**
 * Applying the account's `settings.accessibility` to the document.
 *
 * The OS preference (`prefers-reduced-motion`) keeps working on its own; the
 * account flags are an additional, signed-in-everywhere layer expressed as
 * attributes on <html> that styles.css mirrors:
 *
 *   data-reduce-motion="true"  the same rules as @media (prefers-reduced-motion: reduce)
 *   data-large-text="true"     a larger root font size (the type scale is rem-based)
 *
 * `prefersReducedMotion()` in components/ui.tsx reads the attribute too, so
 * JS-driven motion (presence, pulses, chart draws, smooth scrolling) follows.
 *
 * Import-free so tests can load it straight from source.
 */

export type AccessibilityFlags = { reduceMotion?: boolean | null; largeText?: boolean | null } | null | undefined;

export const REDUCE_MOTION_ATTR = 'data-reduce-motion';
export const LARGE_TEXT_ATTR = 'data-large-text';
/** Dispatched on window after the attributes change, for hooks that want to re-evaluate. */
export const ACCESSIBILITY_EVENT = 'vybe:accessibility';

const setFlag = (root: HTMLElement, attr: string, on: boolean) => {
  if (on) root.setAttribute(attr, 'true');
  else root.removeAttribute(attr);
};

/** Set or clear both attributes from the account flags; absent or null means off. Safe to call without a DOM. */
export function applyAccessibility(flags: AccessibilityFlags): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const before = `${root.getAttribute(REDUCE_MOTION_ATTR)}|${root.getAttribute(LARGE_TEXT_ATTR)}`;
  setFlag(root, REDUCE_MOTION_ATTR, flags?.reduceMotion === true);
  setFlag(root, LARGE_TEXT_ATTR, flags?.largeText === true);
  const after = `${root.getAttribute(REDUCE_MOTION_ATTR)}|${root.getAttribute(LARGE_TEXT_ATTR)}`;
  if (before !== after && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(ACCESSIBILITY_EVENT));
  }
}

/** True when the account asked for less motion (the attribute is set). */
export const accountReduceMotion = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.getAttribute(REDUCE_MOTION_ATTR) === 'true';

/** The OS media query OR the account flag: what every JS-driven animation should check. */
export function reduceMotionRequested(): boolean {
  const media = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return media || accountReduceMotion();
}
