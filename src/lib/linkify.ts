/**
 * Turn the URLs in a message into link segments. Pure so it can be tested in
 * node; the Bubble renders `text` segments as-is, `link` segments as <a>, and
 * `internal` ones (same origin or the app's own host) as router links so a
 * pasted vybeapp.fit URL stays inside the installed app.
 */

export type LinkSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string; internal: string | null };

// http(s) URLs and bare www./domain.tld/path tokens; trailing punctuation is left as text.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"'()]+|(?<![\w@.])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|fit|app|co|dev|me|us|uk|ca|gg|tv|ly|to)(?![\w.])(?:\/[^\s<>"'()]*)?)/gi;

const TRAILING = /[.,;:!?…]+$/;

/** Hosts that count as the app itself (production apex plus the current origin at runtime). */
export const INTERNAL_HOSTS = new Set(['vybeapp.fit', 'www.vybeapp.fit']);

export function linkifySegments(text: string, internalHosts: ReadonlySet<string> = INTERNAL_HOSTS): LinkSegment[] {
  if (!text) return [];
  const out: LinkSegment[] = [];
  let last = 0;
  URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_RE.exec(text))) {
    let raw = match[0];
    let trailing = '';
    const tail = raw.match(TRAILING);
    if (tail) {
      trailing = tail[0];
      raw = raw.slice(0, -trailing.length);
    }
    if (!raw) continue;
    const start = match.index;
    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) });
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let internal: string | null = null;
    try {
      const url = new URL(href);
      if (internalHosts.has(url.hostname.toLowerCase())) internal = `${url.pathname}${url.search}${url.hash}` || '/';
    } catch {
      // Not a URL after all; keep it as a link to the raw text anyway.
    }
    out.push({ kind: 'link', text: raw, href, internal });
    last = start + raw.length;
    if (trailing) {
      out.push({ kind: 'text', text: trailing });
      last += trailing.length;
    }
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export const hasLink = (text: string): boolean => linkifySegments(text).some((s) => s.kind === 'link');
