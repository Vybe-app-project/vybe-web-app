/**
 * Toast viewport rules, pure for testing.
 *
 * On phones the viewport sits above the bottom nav. While a sheet is open
 * that is exactly where the sheet's footer (and its primary button) lives,
 * so an error toast covered the very control the user needed to retry with.
 * With a sheet open on a compact screen the toasts anchor to the top instead.
 */

export const TOAST_LIMIT = 3;

export function toastViewportClass(compact: boolean, modalOpen: boolean): string {
  const base = 'pointer-events-none fixed inset-x-0 z-[200] flex flex-col items-center gap-2 px-4';
  const desktop = 'lg:inset-x-auto lg:bottom-auto lg:right-4 lg:top-4 lg:items-end lg:px-0 lg:pb-0 lg:pt-0';
  if (compact && modalOpen) {
    return `${base} top-0 pt-[calc(env(safe-area-inset-top)+12px)] ${desktop}`;
  }
  return `${base} bottom-0 pb-nav ${desktop}`;
}

export type ToastRecord = { id: number; key?: string };

/**
 * Append a toast, replacing any live toast that shares its `key` (so a
 * validation message re-triggered by repeated taps never stacks) and keeping
 * the newest TOAST_LIMIT.
 */
export function upsertToast<T extends ToastRecord>(list: T[], next: T): T[] {
  const kept = next.key ? list.filter((t) => t.key !== next.key) : list;
  return [...kept.slice(-(TOAST_LIMIT - 1)), next];
}
