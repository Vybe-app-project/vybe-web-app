import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errMsg } from '../../lib/api';
import {
  ANNOUNCEMENT_CONTENT_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  type PinnedPost,
  announcementContent,
  announcementError,
  announcementParts,
  clientRequestId,
  deleteAnnouncement,
  gymV2Keys,
  isFeatureDisabled,
  markAnnouncementSeen,
  postAnnouncement,
} from '../../lib/gymCommunityV2';
import { useAnnouncementSeen } from './useGymV2';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, Skeleton, Textarea, cx, formatStat, useToast } from '../ui';
import { Bell, Check, Trash } from '../icons';

/**
 * The community's own notice, at the top of the gym's Feed tab
 * (`gymAnnouncements`; design-gym-community-v2.md §5.6). An announcement is
 * one `content` string posted as the gym: its first line is the title it
 * chose and the rest is the body, so nothing is truncated into a headline.
 *
 * No route lists announcements — `POST /announcements { pin: true }` puts the
 * notice in the pin strip, and `GET /:gymId/pins` is where the page finds it.
 * Seen-by is the poster's and the moderators' read only, and is `null` below
 * `SEEN_COUNT_MIN`, so the line is omitted rather than shown as a zero.
 *
 * Every part of this file feature-detects: with `gymAnnouncements` off the
 * seen count 404s (the line is absent), mark-seen 404s (nothing is written)
 * and the compose action is not offered at all.
 */

export type AnnouncementCardProps = {
  communityId: string;
  post: PinnedPost;
  /** The gym's name: the card says who is speaking. */
  communityName: string;
  /** Admins, moderators and the poster read "Seen by N"; members never do. */
  canSeeSeenBy?: boolean;
  /** The poster, an admin or the owner may take it down. */
  canManage?: boolean;
  /** The flag is on for this caller: mark-seen is written and seen-by asked for. */
  enabled?: boolean;
  className?: string;
};

/** "Seen by 12" — never "Seen by 0": below SEEN_COUNT_MIN the API sends null and the line goes. */
export function seenByLine(count: number | null | undefined): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null;
  return `Seen by ${formatStat(count)}`;
}

export function AnnouncementCard({
  communityId,
  post,
  communityName,
  canSeeSeenBy = false,
  canManage = false,
  enabled = true,
  className,
}: AnnouncementCardProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { title, body } = useMemo(() => announcementParts(post.content), [post.content]);
  const seen = useAnnouncementSeen(communityId, post._id, enabled && canSeeSeenBy);
  const seenLine = seenByLine(seen.data);

  // Marked seen on view, once per post: a 404 (the flag off, the poster, an
  // opted-out member, a minor) is a no-op the page never mentions.
  const marked = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !post._id || marked.current === post._id) return;
    marked.current = post._id;
    markAnnouncementSeen(communityId, post._id).catch(() => undefined);
  }, [communityId, post._id, enabled]);

  const remove = useMutation({
    mutationFn: () => deleteAnnouncement(communityId, post._id),
    onSuccess: () => {
      toast.success('Announcement taken down');
      setConfirmDelete(false);
      qc.invalidateQueries({ queryKey: gymV2Keys.pins(communityId) });
      qc.invalidateQueries({ queryKey: ['community', communityId, 'posts'] });
    },
    onError: (e) => {
      toast.error(isFeatureDisabled(e) ? 'Announcements are not available on your account yet.' : errMsg(e, 'Could not take the announcement down'));
      setConfirmDelete(false);
    },
  });

  return (
    <Card container className={cx('border-brand/30 bg-brand-soft/40', className)} aria-label={`Announcement from ${communityName}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-text">
          <Bell size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">Announcement</Badge>
            <span className="t-meta truncate">{communityName}</span>
          </div>
          {title ? <h2 className="t-section mt-1.5 text-text-1">{title}</h2> : null}
          {body ? <p className="prose-measure mt-1 whitespace-pre-wrap text-md text-text-1">{body}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {seen.isLoading && canSeeSeenBy ? (
              <Skeleton className="h-3 w-20" />
            ) : seenLine ? (
              <span className="t-meta inline-flex items-center gap-1">
                <Check size={13} />
                {seenLine}
              </span>
            ) : null}
            {canManage ? (
              <Button variant="ghost" size="sm" icon={<Trash size={16} />} onClick={() => setConfirmDelete(true)}>
                Take it down
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="Take the announcement down?"
        message="It comes off the feed and its pin is dropped. You can post another any time."
        confirmLabel="Take it down"
        destructive
        loading={remove.isPending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
      />
    </Card>
  );
}

/** The card's geometry while the pins resolve: the crest, a title line and two body lines. */
export function AnnouncementCardSkeleton() {
  return (
    <Card container aria-busy="true" className="border-brand/30 bg-brand-soft/40">
      <div className="flex items-start gap-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-48 max-w-full" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-3/4" />
        </div>
      </div>
    </Card>
  );
}

/**
 * "Post an announcement": a title and a body, posted as the gym and pinned to
 * the top of the feed. The two travel as one `content` (the API has no title
 * field), keyed on a `clientRequestId` so a retry replays instead of posting
 * twice. `pinned: false` with `pinReason: 'limit'` is said plainly — the
 * notice is up, but three posts were already pinned.
 */
export function PostAnnouncementDialog({
  open,
  communityId,
  communityName,
  onClose,
}: {
  open: boolean;
  communityId: string;
  communityName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [touched, setTouched] = useState(false);
  // One id per attempt, kept until it succeeds: a retry after a timeout
  // replays the same write rather than posting the notice twice.
  const keyRef = useRef(clientRequestId('gym-ann'));

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setBody('');
    setTouched(false);
    keyRef.current = clientRequestId('gym-ann');
  }, [open]);

  const error = announcementError({ title, body });

  const post = useMutation({
    mutationFn: () =>
      postAnnouncement(communityId, {
        clientRequestId: keyRef.current,
        content: announcementContent(title, body),
        pin: true,
      }),
    onSuccess: (result) => {
      if (result.held) toast.info('Your announcement is waiting for a moderator before it shows.');
      else if (result.pinned === false && result.pinReason === 'limit') toast.success('Announcement posted. Three posts are already pinned, so it is not at the top — unpin one to move it there.');
      else toast.success(`Announcement posted to ${communityName}`);
      keyRef.current = clientRequestId('gym-ann');
      qc.invalidateQueries({ queryKey: gymV2Keys.pins(communityId) });
      qc.invalidateQueries({ queryKey: ['community', communityId, 'posts'] });
      qc.invalidateQueries({ queryKey: gymV2Keys.composerContext(communityId) });
      onClose();
    },
    onError: (e) => {
      toast.error(isFeatureDisabled(e) ? 'Announcements are not available on your account yet.' : errMsg(e, 'Could not post the announcement'));
    },
  });

  const submit = () => {
    setTouched(true);
    if (!error) post.mutate();
  };

  const remaining = ANNOUNCEMENT_CONTENT_MAX - announcementContent(title, body).length;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Post an announcement"
      description={`It goes out as ${communityName} and sits at the top of the feed. Members at All or Highlights are told.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={post.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={post.isPending} disabled={touched && Boolean(error)}>
            Post announcement
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <Input
          label="Title"
          value={title}
          maxLength={ANNOUNCEMENT_TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setTouched(true)}
          error={touched && error ? error : undefined}
          hint={touched && error ? undefined : 'One line, e.g. “Squat racks out of action on Friday”.'}
          autoComplete="off"
          autoFocus
          required
        />
        <Textarea
          label="What members need to know"
          rows={4}
          autoGrow
          maxRows={12}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          hint={`Optional. ${remaining} characters left for the title and body together.`}
        />
      </form>
    </Modal>
  );
}
