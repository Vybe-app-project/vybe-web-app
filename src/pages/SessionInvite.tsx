import { useMemo, useState } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Layout from '../components/Layout';
import { PublicShell } from '../components/PublicShell';
import { api, errMsg, parseApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useSessionsAccess } from '../lib/capabilities';
import {
  CANCEL_CONFIRM_LABEL,
  CANCEL_MESSAGE,
  CANCEL_REASON_LABEL,
  CANCEL_REASON_MAX,
  CANCEL_TITLE,
  INVALID_LINK_BODY,
  INVALID_LINK_TITLE,
  LEAVE_TITLE,
  OPEN_IN_APP,
  REFRESH_FAILED,
  ROLLOUT_NOTE,
  ROOM_NOTE,
  ROOM_NOTE_DESKTOP,
  SESSIONS_OFF_BODY,
  SESSIONS_OFF_TITLE,
  SHARE_PROGRESS_HELPER,
  SHARE_PROGRESS_LABEL,
  SIGNED_OUT_SUBTITLE,
  SIGNED_OUT_TITLE,
  UNAVAILABLE_BODY,
  UNAVAILABLE_TITLE,
  actorName,
  activeParticipants,
  countLine,
  emptyPeopleLine,
  formatSessionTime,
  hostName,
  isOpenStatus,
  leaveConfirmMessage,
  programLine,
  programPath,
  programTitle,
  sessionActions,
  sessionDeepLink,
  sessionLookup,
  sessionStateCopy,
  viewerReasonFromCode,
  viewerReasonLine,
  visibilityLine,
  type SessionEnvelope,
  type SessionViewer,
  type TogetherSession,
  type ViewerReason,
} from '../lib/sessionInvite';
import { isHandheld } from '../lib/shareLinks';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  Checkbox,
  ConfirmDialog,
  ErrorState,
  FullPageSpinner,
  Modal,
  PageHeader,
  Skeleton,
  Textarea,
  buttonClass,
  cx,
  humanize,
  isoStamp,
  useToast,
} from './ui';
import { BadgeCheck, Clock, Dumbbell, Users } from './icons';

/**
 * /session/:id and /session/invite/:token — the web landing for a Together
 * session. The web has no live room (the runner, presence, high fives and
 * the count-in are socket-only and live in the app), so this page shows the
 * details, lets the viewer join or leave, lets the host cancel, and hands
 * the live room to the app through the vybe:// deep link.
 *
 * The route param is either a 24-hex session id (the mobile share link) or
 * the API's 64-hex invite token (`inviteUrl`); the lookup dispatches by
 * shape to GET /sessions/:id or GET /sessions/invite/:token.
 *
 * Start and End are deliberately absent: a host starting from here would
 * strand everyone in a live room the web cannot run.
 */

type Busy = 'join' | 'leave' | 'cancel' | null;

const STATE_BADGE = { info: 'info', success: 'success', warning: 'warning', neutral: 'neutral' } as const;
const STATUS_LABEL: Record<TogetherSession['status'], string> = { scheduled: 'Scheduled', lobby: 'Lobby open', live: 'Live', ended: 'Ended', cancelled: 'Cancelled' };

/* ------------------------------------------------------------------ body (pure) */

export type SessionInviteBodyProps = {
  session: TogetherSession;
  viewer: SessionViewer;
  /** The signed-in member's id; a prop so the server renderer sees it (zustand serves the initial store there). */
  meId: string | null;
  busy: Busy;
  /** features.sessions is off for this caller: the invite still works, say so once. */
  rolloutOff: boolean;
  /** A phone or tablet: only there can the vybe:// link open the app, so a desktop gets a plain line instead. */
  handheld: boolean;
  onJoin: (shareProgress: boolean) => void;
  onLeave: () => void;
  onCancel: () => void;
  /** Tests pass 'UTC'; the browser prints its own zone. */
  timeZone?: string;
};

/** Props-only render of a loaded session; the confirm dialogs live in the page. */
export function SessionInviteBody({ session, viewer, meId, busy, rolloutOff, handheld, onJoin, onLeave, onCancel, timeZone }: SessionInviteBodyProps) {
  const [shareProgress, setShareProgress] = useState(true);
  const host = hostName(session);
  const title = programTitle(session);
  const state = sessionStateCopy(session, viewer, { timeZone });
  const reasonLine = viewerReasonLine(viewer, host, session);
  const actions = sessionActions(session, viewer);
  const people = activeParticipants(session);
  const emptyLine = emptyPeopleLine(session, viewer);
  const exercises = (session.snapshot?.exercises ?? []).filter((exercise) => exercise && exercise.name);
  const workoutPath = programPath(session);
  const redacted = viewer.reason === 'removed';

  return (
    <div className="mx-auto w-full max-w-form space-y-4">
      <Card>
        <div className="flex items-start gap-3">
          <Avatar src={session.host?.avatar} name={host} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-text-2">Hosted by</p>
            <p className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-md font-semibold text-text-1">{host}</span>
              {session.host?.isIdentityVerified ? <BadgeCheck size={16} className="shrink-0 text-brand" aria-label="Verified" role="img" /> : null}
              <Badge tone="brand" size="sm">Host</Badge>
            </p>
            {session.host?.username ? <p className="truncate text-xs text-text-2">@{session.host.username}</p> : null}
          </div>
        </div>

        <section aria-live="polite" data-testid="session-state" data-status={session.status} className="mt-4 rounded-md bg-surface-2 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATE_BADGE[state.tone]} dot={session.status === 'live'}>
              {STATUS_LABEL[session.status] ?? humanize(session.status)}
            </Badge>
            <h2 className="text-md font-semibold text-text-1">{state.title}</h2>
          </div>
          {state.body ? <p className="mt-1.5 text-sm text-text-2">{state.body}</p> : null}
          {reasonLine ? <p className="mt-1.5 text-sm text-text-1">{reasonLine}</p> : null}
        </section>

        {rolloutOff ? (
          <Callout tone="info" className="mt-4">
            {ROLLOUT_NOTE}
          </Callout>
        ) : null}

        <div className="mt-4 space-y-3">
          {handheld ? (
            <>
              {/* Primary only for a member, whose next step is the room; a refused viewer meets the same refusal in the app. */}
              <a href={sessionDeepLink(session._id)} className={buttonClass({ variant: viewer.joined ? 'primary' : 'secondary', size: 'lg', block: true })} data-testid="session-open-app">
                {OPEN_IN_APP}
              </a>
              <p className="text-xs leading-relaxed text-text-2">{ROOM_NOTE}</p>
            </>
          ) : (
            <p className="text-sm leading-relaxed text-text-2" data-testid="session-room-note">
              {ROOM_NOTE_DESKTOP}
            </p>
          )}

          {actions.join ? (
            <div className="rounded-md border border-line p-3">
              <Checkbox checked={shareProgress} onChange={setShareProgress} label={SHARE_PROGRESS_LABEL} description={SHARE_PROGRESS_HELPER} disabled={busy !== null} />
              <Button
                variant="primary"
                size="lg"
                block
                loading={busy === 'join'}
                disabled={busy !== null}
                onClick={() => onJoin(shareProgress)}
                aria-label={`Join ${title}`}
                data-testid="session-join"
                className="mt-2"
              >
                Join
              </Button>
            </div>
          ) : null}

          {actions.openProgram && workoutPath ? (
            <ButtonLink to={workoutPath} variant="primary" size="lg" block>
              Open the program
            </ButtonLink>
          ) : null}

          {actions.leave || actions.cancel ? (
            <div className="flex flex-wrap gap-2">
              {actions.leave ? (
                <Button variant="secondary" loading={busy === 'leave'} disabled={busy !== null} onClick={onLeave} aria-label="Leave this session" data-testid="session-leave">
                  Leave
                </Button>
              ) : null}
              {actions.cancel ? (
                <Button variant="danger" loading={busy === 'cancel'} disabled={busy !== null} onClick={onCancel} aria-label={`Cancel session: ${title}`} data-testid="session-cancel">
                  Cancel session
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-text" aria-hidden="true">
            <Dumbbell size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-md font-semibold text-text-1">{title}</h2>
            <p className="text-xs text-text-2">
              {[humanize(session.snapshot?.category), programLine(session)].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        {exercises.length ? (
          <ul aria-label="Program" className="mt-3 divide-y divide-line text-sm">
            {exercises.map((exercise, index) => (
              <li key={`${exercise.name}-${index}`} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-text-1">{exercise.name}</span>
                <span className="tabular shrink-0 text-xs text-text-2">{exercise.sets > 0 ? `${exercise.sets} ${exercise.sets === 1 ? 'set' : 'sets'}` : ''}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <Clock size={16} className="shrink-0 text-text-3" aria-hidden="true" />
            <dt className="sr-only">When</dt>
            <dd className="text-text-2">
              <time dateTime={isoStamp(session.scheduledAt)}>{formatSessionTime(session.scheduledAt, { timeZone })}</time>
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <Users size={16} className="shrink-0 text-text-3" aria-hidden="true" />
            <dt className="sr-only">Who can join</dt>
            <dd className="text-text-2">{visibilityLine(session)}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-md font-semibold text-text-1">People</h2>
          <p className="tabular text-xs text-text-2" data-testid="session-count">
            {countLine(session)}
          </p>
        </div>
        {!redacted && people.length ? (
          <ul aria-label="People" data-testid="session-participants" className="mt-3 divide-y divide-line">
            {people.map((participant) => {
              const name = actorName(participant.user);
              const you = meId !== null && participant.user?._id === meId;
              return (
                <li key={participant.user?._id ?? name} className="flex items-center gap-3 py-2">
                  <Avatar src={participant.user?.avatar} name={name} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm text-text-1">{name}</span>
                  {participant.role === 'host' ? <Badge tone="brand" size="sm">Host</Badge> : null}
                  {you ? <Badge tone="neutral" size="sm">You</Badge> : null}
                  {typeof participant.online === 'boolean' ? (
                    <span
                      role="img"
                      aria-label={participant.online ? 'online' : 'offline'}
                      className={cx('inline-block h-2 w-2 rounded-full', participant.online ? 'bg-success' : 'bg-line-strong')}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {emptyLine ? <p className="mt-3 text-sm text-text-2">{emptyLine}</p> : null}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ states */

function SessionsOff() {
  return (
    <>
      <PageHeader title="Session" />
      <Card className="mx-auto flex w-full max-w-form flex-col items-center gap-5 py-12 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-soft text-brand-text" aria-hidden="true">
          <Users size={32} />
        </span>
        <div className="max-w-md space-y-2">
          <h2 className="type-heading text-xl text-text-1">{SESSIONS_OFF_TITLE}</h2>
          <p className="text-base leading-relaxed text-text-2">{SESSIONS_OFF_BODY}</p>
        </div>
        <ButtonLink to="/workouts" variant="primary">
          Browse workouts
        </ButtonLink>
      </Card>
    </>
  );
}

function SessionSkeleton() {
  return (
    <>
      <PageHeader title="Session" />
      <div className="mx-auto w-full max-w-form space-y-4" aria-busy="true" aria-label="Loading session">
        <Card>
          <div className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
          <Skeleton className="mt-4 h-20 w-full rounded-md" />
          <Skeleton className="mt-4 h-12 w-full rounded-md" />
        </Card>
        <Card>
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-5/6" />
        </Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ signed-in page */

const statusOf = (error: unknown): number | null => parseApiError(error).status;

/** The routed page for a signed-in member: capabilities gate, detail query, join / leave / cancel. */
export function SessionInvitePage() {
  const { id, token } = useParams();
  const [params] = useSearchParams();
  const lookup = useMemo(() => sessionLookup(token ?? id), [token, id]);
  const queryToken = params.get('inviteToken');
  const meId = useAuth((s) => s.user?._id ?? null);
  const caps = useSessionsAccess();
  const qc = useQueryClient();
  const toast = useToast();
  const [forcedOff, setForcedOff] = useState(false);
  // A join refusal the API named (full, late, ...), pinned to the fetch it answered against so the next fresh detail wins.
  const [localReason, setLocalReason] = useState<{ reason: ViewerReason; at: number } | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [handheld] = useState(isHandheld);

  // The kill switch hides the page (and a 503 SESSIONS_DISABLED from join or
  // cancel flips it too, since the capabilities answer is cached); the rollout
  // flag only adds a note, because the API answered and the invite is real.
  const sessionsOn = !forcedOff && caps.enabled;
  const rolloutOff = caps.rolloutOff;

  const queryKey = useMemo(() => ['session', lookup.kind, lookup.value, queryToken] as const, [lookup.kind, lookup.value, queryToken]);
  const inviteToken = lookup.kind === 'token' ? lookup.value : queryToken;

  // A refetch the API is known to refuse: it just said the session is gone
  // (unavailable), or the link died with the cancel (a cancel revokes the
  // invite token; an end does not, so an ended refetch repairs the page).
  const linkGone = (reason: ViewerReason): boolean => reason === 'unavailable' || (reason === 'cancelled' && inviteToken !== null);
  const deadLink = localReason !== null && linkGone(localReason.reason) ? localReason : null;
  const linkDeadFor = (dataUpdatedAt: number): boolean => deadLink !== null && deadLink.at === dataUpdatedAt;
  // Poll only while the room can still change and the link still answers; a
  // terminal session never refetches.
  const stillOpen = (state: { data?: SessionEnvelope; dataUpdatedAt: number }): boolean =>
    !!state.data && isOpenStatus(state.data.session.status) && !linkDeadFor(state.dataUpdatedAt);

  const q = useQuery({
    queryKey,
    enabled: lookup.kind !== 'invalid' && sessionsOn && !caps.isLoading,
    retry: false,
    refetchInterval: (query) => (stillOpen(query.state) ? 15_000 : false),
    refetchOnWindowFocus: (query) => stillOpen(query.state),
    refetchOnReconnect: (query) => stillOpen(query.state),
    queryFn: async (): Promise<SessionEnvelope> => {
      const { data } = lookup.kind === 'token'
        ? await api.get(`/sessions/invite/${lookup.value}`)
        : await api.get(`/sessions/${lookup.value}`, { params: queryToken ? { inviteToken: queryToken } : undefined });
      return data as SessionEnvelope;
    },
  });

  const sessionId = q.data?.session._id ?? null;

  const join = useMutation({
    mutationFn: async (shareProgress: boolean) => {
      const { data } = await api.post(`/sessions/${sessionId}/join`, { shareProgress, ...(inviteToken ? { inviteToken } : {}) });
      return data as SessionEnvelope & { alreadyJoined?: boolean };
    },
    onSuccess: (data) => {
      setLocalReason(null);
      qc.setQueryData(queryKey, { session: data.session, viewer: data.viewer });
      toast.success(data.alreadyJoined ? 'You’re already in this session.' : 'You’re in.');
    },
    onError: (error) => {
      const code = parseApiError(error).code;
      if (code === 'SESSIONS_DISABLED') {
        setForcedOff(true);
        return;
      }
      const reason = viewerReasonFromCode(code);
      if (reason) {
        setLocalReason({ reason, at: q.dataUpdatedAt });
        // Refresh the counts and status, unless the refetch is known to 404; that one stays as told.
        if (!linkGone(reason)) void qc.invalidateQueries({ queryKey });
      }
      toast.error(errMsg(error, 'Couldn’t join the session. Try again.'));
    },
  });

  const leave = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/sessions/${sessionId}/leave`);
      return data as { session: TogetherSession; left: boolean };
    },
    onSuccess: (data) => {
      setLeaveOpen(false);
      const previous = qc.getQueryData<SessionEnvelope>(queryKey);
      if (!isOpenStatus(data.session.status) && previous) {
        // The last one out closed the room (and a scheduled room's token with
        // it): keep the returned session and the viewer state the API would
        // now compute, rather than refetching into a 404.
        const reason: ViewerReason = data.session.status === 'cancelled' ? 'cancelled' : 'ended';
        qc.setQueryData(queryKey, {
          session: data.session,
          viewer: { joined: false, isHost: false, shareProgress: previous.viewer.shareProgress, canJoin: false, reason },
        });
      } else {
        // The leave envelope carries no viewer: read the detail again.
        void qc.invalidateQueries({ queryKey: ['session'] });
      }
      toast.success(data.left ? 'You left the session.' : 'You’re not in this session.');
    },
    onError: (error) => {
      setLeaveOpen(false);
      toast.error(errMsg(error, 'Couldn’t leave the session. Try again.'));
      void qc.invalidateQueries({ queryKey: ['session'] });
    },
  });

  const cancel = useMutation({
    mutationFn: async (reason: string) => {
      const trimmed = reason.trim().slice(0, CANCEL_REASON_MAX);
      const { data } = await api.post(`/sessions/${sessionId}/cancel`, trimmed ? { reason: trimmed } : {});
      return data as SessionEnvelope;
    },
    onSuccess: (data) => {
      setCancelOpen(false);
      setCancelReason('');
      // Terminal status: polling stops and the token (now revoked) is never used again.
      qc.setQueryData(queryKey, { session: data.session, viewer: data.viewer });
      toast.success('Session cancelled. Everyone who joined has been told.');
    },
    onError: (error) => {
      setCancelOpen(false);
      const code = parseApiError(error).code;
      if (code === 'SESSIONS_DISABLED') {
        setForcedOff(true);
        return;
      }
      toast.error(errMsg(error, 'Couldn’t cancel the session. Try again.'));
      void qc.invalidateQueries({ queryKey });
    },
  });

  if (!sessionsOn) return <SessionsOff />;

  if (lookup.kind === 'invalid') {
    return (
      <>
        <PageHeader title="Session" />
        <ErrorState
          title={INVALID_LINK_TITLE}
          message={INVALID_LINK_BODY}
          action={
            <ButtonLink to="/" variant="primary">
              Go to Vybe
            </ButtonLink>
          }
        />
      </>
    );
  }

  // Only an empty page shows the error state: a failed background poll keeps
  // the cached session beside the error, and the loaded page (with its open
  // dialogs) stays up and says so inline.
  if (q.isError && !q.data) {
    const notFound = statusOf(q.error) === 404;
    return (
      <>
        <PageHeader title="Session" />
        {notFound ? (
          <ErrorState
            title={UNAVAILABLE_TITLE}
            message={UNAVAILABLE_BODY}
            action={
              <ButtonLink to="/" variant="primary">
                Go to Vybe
              </ButtonLink>
            }
          />
        ) : (
          <ErrorState error={q.error} retry={() => void q.refetch()} />
        )}
      </>
    );
  }

  if (caps.isLoading || q.isLoading || !q.data) return <SessionSkeleton />;

  const { session } = q.data;
  const pinned = localReason && localReason.at === q.dataUpdatedAt && !q.data.viewer.joined ? localReason.reason : null;
  const viewer: SessionViewer = pinned ? { ...q.data.viewer, canJoin: false, reason: pinned } : q.data.viewer;
  const host = hostName(session);
  const title = programTitle(session);
  const busy: Busy = join.isPending ? 'join' : leave.isPending ? 'leave' : cancel.isPending ? 'cancel' : null;
  const activeCount = activeParticipants(session).length;
  // A dead link is not news: the pinned reason already says why the page is as it is.
  const refreshFailed = q.isError && !linkDeadFor(q.dataUpdatedAt);

  return (
    <>
      <PageHeader title={title} subtitle={`with ${host}`} />
      {refreshFailed ? (
        <Callout
          tone="warning"
          className="mx-auto mb-4 w-full max-w-form"
          action={
            <Button variant="secondary" size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}>
              Retry
            </Button>
          }
        >
          {REFRESH_FAILED}
        </Callout>
      ) : null}
      <SessionInviteBody
        session={session}
        viewer={viewer}
        meId={meId}
        busy={busy}
        rolloutOff={rolloutOff}
        handheld={handheld}
        onJoin={(shareProgress) => join.mutate(shareProgress)}
        onLeave={() => setLeaveOpen(true)}
        onCancel={() => setCancelOpen(true)}
      />

      <ConfirmDialog
        open={leaveOpen}
        title={LEAVE_TITLE}
        message={leaveConfirmMessage(viewer, activeCount)}
        confirmLabel="Leave"
        loading={leave.isPending}
        onConfirm={() => leave.mutate()}
        onCancel={() => setLeaveOpen(false)}
      />

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={CANCEL_TITLE}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelOpen(false)} disabled={cancel.isPending}>
              Keep session
            </Button>
            <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate(cancelReason)}>
              {CANCEL_CONFIRM_LABEL}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-text-2">{CANCEL_MESSAGE}</p>
        <Textarea
          label={CANCEL_REASON_LABEL}
          value={cancelReason}
          onChange={(event) => setCancelReason(event.target.value)}
          maxLength={CANCEL_REASON_MAX}
          rows={3}
          hint={`${cancelReason.length}/${CANCEL_REASON_MAX}`}
          containerClassName="mt-3"
        />
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ signed-out landing */

/**
 * The landing for a visitor without a session: sign in (keeping this URL),
 * or open the app on a phone. A malformed link is told so here, before the
 * visitor is asked to sign in for nothing. `handheld` is a prop so the
 * server renderer in tests can pick either branch.
 */
export function SessionLanding({ handheld: handheldProp }: { handheld?: boolean } = {}) {
  const { id, token } = useParams();
  const location = useLocation();
  const lookup = sessionLookup(token ?? id);
  const [detected] = useState(isHandheld);
  const handheld = handheldProp ?? detected;
  const from = { from: location };
  if (lookup.kind === 'invalid') {
    return (
      <PublicShell title={INVALID_LINK_TITLE} subtitle={INVALID_LINK_BODY}>
        <ButtonLink to="/" variant="primary" size="lg">
          Go to Vybe
        </ButtonLink>
      </PublicShell>
    );
  }
  return (
    <PublicShell title={SIGNED_OUT_TITLE} subtitle={SIGNED_OUT_SUBTITLE}>
      <div className="space-y-3">
        <ButtonLink to="/login" state={from} variant="primary" size="lg" block>
          Log in to see this session
        </ButtonLink>
        {handheld ? (
          <a href={sessionDeepLink(lookup.value)} className={buttonClass({ variant: 'secondary', size: 'lg', block: true })} data-testid="session-open-app">
            {OPEN_IN_APP}
          </a>
        ) : null}
        <ButtonLink to="/register" state={from} variant="ghost" size="lg" block>
          Join Vybe
        </ButtonLink>
        <p className="text-sm leading-relaxed text-text-2">{handheld ? ROOM_NOTE : ROOM_NOTE_DESKTOP}</p>
      </div>
    </PublicShell>
  );
}

/* ------------------------------------------------------------------ gate */

/**
 * The routed element (App.tsx, pattern of PostGate): signed-out visitors get
 * the sign-in hand-off with this location as the return target; members get
 * the page inside the app shell.
 */
export function SessionGate() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (user) {
    return (
      <Layout>
        <SessionInvitePage />
      </Layout>
    );
  }
  return <SessionLanding />;
}

export default SessionGate;
