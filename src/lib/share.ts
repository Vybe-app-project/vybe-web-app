/**
 * Share-link plumbing shared by meals, meal templates and weekly plans.
 *
 * The API mints link tokens for all three (POST /meals/:id/share,
 * /meal-templates/:id/share-token, /weekly-plans/:id/share-token) and each has
 * a recipient page or modal. The web only ever wired the template one; meals
 * copied `/meals/:id`, which is private to its owner and answered 404 for the
 * friend it was sent to.
 */

type ToastLike = {
  success: (message: string, options?: { action?: { label: string; onClick: () => void }; duration?: number }) => unknown;
  info: (message: string, options?: { action?: { label: string; onClick: () => void }; duration?: number }) => unknown;
};

/** 64 hex chars: every share token the API mints. */
export const SHARE_TOKEN = /^[a-f0-9]{64}$/i;
/** 24 hex chars: a Mongo id, which older public-plan links carried instead. */
export const OBJECT_ID = /^[a-f0-9]{24}$/i;

export const shareUrls = {
  meal: (token: string) => `${location.origin}/meals/shared/${encodeURIComponent(token)}`,
  template: (token: string) => `${location.origin}/meals/templates?shared=${encodeURIComponent(token)}`,
  plan: (token: string) => `${location.origin}/meals/plans?shared=${encodeURIComponent(token)}`,
};

/**
 * Hand a URL to the OS share sheet when there is one, otherwise put it on the
 * clipboard, otherwise show it so it can be copied by hand. A dismissed share
 * sheet is not an error.
 */
export async function shareOrCopy(url: string, title: string, toast: ToastLike, copiedMessage = 'Share link copied'): Promise<'shared' | 'copied' | 'shown' | 'cancelled'> {
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title, url });
      return 'shared';
    }
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') return 'cancelled';
    // Fall through to the clipboard.
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success(copiedMessage);
    return 'copied';
  } catch {
    toast.info(`Share link: ${url}`, { duration: 8000 });
    return 'shown';
  }
}

/** Copy only, for the explicit "Copy link" menu item. */
export async function copyLink(url: string, toast: ToastLike, copiedMessage = 'Link copied'): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    toast.success(copiedMessage);
    return true;
  } catch {
    toast.info(`Link: ${url}`, { duration: 8000 });
    return false;
  }
}
