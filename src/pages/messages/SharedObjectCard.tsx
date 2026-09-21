/**
 * A shared object in a chat bubble, and the link preview beneath a message.
 *
 * The card is title · two facts · a tap-through, beside the existing
 * SharedPostCard. It reads `access` on every render, not once: the server
 * recomputes it per read, so a card that opened yesterday can be `preview`
 * today (the viewer lost sight of the object) or `gone` (it was deleted).
 * What was already seen is not retracted — a `preview` card keeps its title
 * and facts and simply stops being a link.
 *
 * The link preview is text only. `linkUnfurl` reserves `imageKey` on the
 * model and never emits it (D-117), so there is no media box to reserve and
 * no layout shift to design around; a card that grew an image later would
 * be a new decision, not a missing one.
 */
import { Link } from 'react-router-dom';
import {
  ATTACHMENT_WORD,
  attachmentFacts,
  attachmentHref,
  attachmentTitle,
  hasLinkPreview,
  linkPreviewHost,
  type LinkPreview,
  type SharedAttachment,
} from '../../lib/sharedCards';
import { cx } from '../ui';
import { BookOpen, Building, Calendar, ClipboardList, Dumbbell, Link as LinkIcon, Sparkles, Trophy, Users } from '../icons';

/** One glyph per kind, so a card is recognisable before it is read. */
const ICON = {
  post: BookOpen,
  workout: Dumbbell,
  routine: ClipboardList,
  recap: Sparkles,
  session: Users,
  event: Calendar,
  challenge: Trophy,
  gym: Building,
} as const;

/**
 * One shared object. `gone` keeps the row so the conversation still reads
 * ("Ana shared a workout" is part of what was said) but says plainly that
 * the thing is not there any more.
 */
export function SharedObjectCard({ attachment }: { attachment: SharedAttachment }) {
  const gone = attachment.access === 'gone';
  const href = attachmentHref(attachment);
  const Icon = ICON[attachment.type] || BookOpen;
  const facts = attachmentFacts(attachment);
  const subtitle = attachment.preview?.subtitle?.trim();

  const body = (
    <>
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xs bg-surface-3 text-text-3">
        <Icon size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-text-2">
          {ATTACHMENT_WORD[attachment.type] || 'Shared'}
          {gone ? ' · no longer available' : ''}
        </span>
        <span className="block truncate text-sm font-semibold text-text-1">{attachmentTitle(attachment)}</span>
        {gone ? null : (
          <span className="block truncate text-xs text-text-2">{facts.length ? facts.join(' · ') : subtitle || ''}</span>
        )}
      </span>
    </>
  );

  const shell = 'mt-1 flex items-center gap-3 rounded-md border border-line bg-surface-1 p-2 pr-3';
  if (!href) return <span className={cx(shell, gone && 'opacity-70')}>{body}</span>;
  return (
    <Link to={href} viewTransition className={cx(shell, 'transition-colors dur-1 hover:bg-surface-2')}>
      {body}
    </Link>
  );
}

/**
 * The compact card under a message's text. Only an `ok` preview with
 * something to say is drawn; `pending`, `none`, `error`, `skipped` and
 * `removed` all render nothing, because a placeholder for a preview that
 * may never arrive is a hole (docs/DESIGN.md, the zero rule).
 */
export function LinkPreviewCard({ preview }: { preview: LinkPreview | null | undefined }) {
  if (!hasLinkPreview(preview)) return null;
  const host = linkPreviewHost(preview);
  const href = preview.canonicalUrl || preview.url;
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      className="mt-1 block rounded-md border border-line bg-surface-1 p-2.5 transition-colors dur-1 hover:bg-surface-2"
    >
      {preview.title ? <span className="line-clamp-2 block text-sm font-semibold text-text-1">{preview.title}</span> : null}
      {preview.description ? <span className="mt-0.5 line-clamp-2 block text-xs text-text-2">{preview.description}</span> : null}
      {host ? (
        <span className="mt-1 flex items-center gap-1 text-2xs text-text-3">
          <LinkIcon size={12} />
          <span className="truncate">{host}</span>
        </span>
      ) : null}
    </a>
  );
}
