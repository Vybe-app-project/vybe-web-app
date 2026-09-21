import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  BOARD_PERIODS,
  BOARD_PERIOD_LABELS,
  acceptChallengeRequest,
  challengeKeys,
  dayOfLine,
  daysLeftLabel,
  daysLeftUrgent,
  declineChallengeRequest,
  endChallengeNow,
  fetchChallengeBoard,
  fetchChallengeLeaderboard,
  fetchChallengeStats,
  legacyBoardEntries,
  metricLabel,
  myShareLine,
  removeChallengeParticipant,
  transferChallengeHost,
  trustRuleFor,
  type BoardPeriod,
  type ChallengeActor,
  type ChallengeSeat,
} from '../../lib/challenges';
import { isWeightScored, mapChallengeError } from '../../lib/challengeRules';
import { formatChallengeWindow, unitLabel } from '../../lib/challengeFormat';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Menu,
  Modal,
  SegmentedControl,
  Skeleton,
  StatGrid,
  StatTile,
  cx,
  formatStat,
  humanize,
  useToast,
  type MenuItem,
} from '../../components/ui';
import {
  Activity,
  Calendar,
  Check,
  Clock,
  Flame,
  Shield,
  Target,
  TrendingUp,
  Trophy,
  UserPlus,
  Users,
} from '../../components/icons';
import { ChallengeAward, ChallengeBoardPane, ChallengeBoardSkeleton, ChallengeLeaderboardList } from './ChallengeBoard';
import ChallengeInviteDialog from './ChallengeInviteDialog';
import type { Challenge } from '../Challenges';

/**
 * The v2 challenge detail (P8a): four panes and, for the host, a fifth.
 *
 *   Board     the leaderboard with **your row pinned** when you are not in
 *             the visible slice (`GET /board?around=me`), or the pooled
 *             total and its contributors for a Group Goal.
 *   Stats     `GET /stats` — who is in, how far through the window it is,
 *             the group total and your share of it.
 *   Activity  what has counted for you in the chosen period, and the one
 *             action that moves it. There is no check-in list to draw: on a
 *             v2 challenge both `PUT /progress` and `POST /auto-update`
 *             answer 400 CHALLENGE_PROGRESS_COMPUTED, so nothing is typed
 *             in and nothing is synced by hand — which is the trust rule.
 *   Rules     the scoring type in words, the daily cap, the window and its
 *             Monday reset, who can see it and how joining works.
 *   Manage    host only: open requests, participants, transfer, end early.
 *
 * Photo proof stays off (D-99) so no photo check-in is built here.
 *
 * A weight-scored challenge keeps the v1 handling: no board, no numbers, and
 * it says why — the API redacts the payload and 404s its board routes.
 */

type DetailResponse = {
  success: boolean;
  challenge: Challenge;
  /** The viewer's seat (v2 + flag on): the state, not the score. */
  me?: ChallengeSeat | null;
  isHost?: boolean;
  hostId?: string;
};

type Pane = 'board' | 'stats' | 'activity' | 'rules' | 'manage';

const idOf = (value: { _id?: string } | string | null | undefined): string =>
  typeof value === 'string' ? value : (value?._id ?? '');

const actorOf = (value: ChallengeActor | string): ChallengeActor => (typeof value === 'string' ? { _id: value } : value);

const nameOf = (user: ChallengeActor): string => user.fullName || user.username || 'Vybe athlete';

const MODE_LABEL: Record<string, string> = {
  group_goal: 'Group goal',
  board: 'Leaderboard',
  head_to_head: 'Head to head',
};

const PROOF_LINE: Record<string, string> = {
  none: 'No photo needed.',
  photo_or_device: 'A photo or a device reading can back up a day.',
  same_day_photo: 'A day is backed up by a photo taken that day.',
};

const VISIBILITY_LINE: Record<string, string> = {
  participants: 'Only the people in it can see the board.',
  community: 'Anyone in the gym community can see it.',
  followers: 'Your followers can see it.',
};

/* ------------------------------------------------------------------ Manage */

function ManagePane({
  challenge,
  hostId,
  onInvite,
  canInvite,
}: {
  challenge: Challenge;
  hostId: string;
  onInvite: () => void;
  canInvite: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [removing, setRemoving] = useState<{ userId: string; name: string } | null>(null);
  const [reason, setReason] = useState('');
  const [endOpen, setEndOpen] = useState(false);
  const [handOver, setHandOver] = useState<{ userId: string; name: string } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['challenges'] });
  const fail = (e: unknown, fallback: string) => toast.error(mapChallengeError((e as { response?: { data?: unknown } })?.response?.data, fallback).message);

  const requests = challenge.joinRequests ?? [];
  const seated = (challenge.participants ?? []).filter((p) => p.state !== 'removed' && p.state !== 'left');

  const accept = useMutation({
    mutationFn: (userId: string) => acceptChallengeRequest(challenge._id, userId),
    onSuccess: () => {
      toast.success('They are in.');
      invalidate();
    },
    onError: (e) => fail(e, 'Could not accept that request'),
  });

  const decline = useMutation({
    mutationFn: (userId: string) => declineChallengeRequest(challenge._id, userId),
    onSuccess: () => {
      toast.info('Request declined. Nobody is told.');
      invalidate();
    },
    onError: (e) => fail(e, 'Could not decline that request'),
  });

  const remove = useMutation({
    mutationFn: () => removeChallengeParticipant(challenge._id, removing?.userId ?? '', reason.trim()),
    onSuccess: () => {
      toast.success(`${removing?.name ?? 'They'} was removed. Their history stays.`);
      setRemoving(null);
      setReason('');
      invalidate();
    },
    onError: (e) => fail(e, 'Could not remove that participant'),
  });

  const transfer = useMutation({
    mutationFn: () => transferChallengeHost(challenge._id, handOver?.userId ?? ''),
    onSuccess: () => {
      toast.success(`${handOver?.name ?? 'They'} is the host now.`);
      setHandOver(null);
      invalidate();
    },
    onError: (e) => fail(e, 'Could not hand over the host'),
  });

  const end = useMutation({
    mutationFn: () => endChallengeNow(challenge._id),
    onSuccess: () => {
      toast.success('Challenge ended. Everyone keeps their days.');
      setEndOpen(false);
      invalidate();
    },
    onError: (e) => fail(e, 'Could not end the challenge'),
  });

  return (
    <div className="space-y-6">
      {requests.length ? (
        <section className="space-y-1">
          <h3 className="t-section text-text-1">
            Waiting to join{' '}
            <Badge tone="brand" size="sm" className="tabular">
              {formatStat(requests.length)}
            </Badge>
          </h3>
          <ul className="divide-y divide-line">
            {requests.map((request) => {
              const user = actorOf(request.user as ChallengeActor | string);
              return (
                <li key={user._id} className="flex items-center gap-3 py-2.5">
                  <Avatar src={user.avatar} name={nameOf(user)} size="sm" seed={user._id} />
                  <p className="t-body min-w-0 flex-1 truncate text-text-1">{nameOf(user)}</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={decline.isPending && decline.variables === user._id}
                    onClick={() => decline.mutate(user._id)}
                  >
                    Decline
                  </Button>
                  <Button
                    variant="brand"
                    size="sm"
                    loading={accept.isPending && accept.variables === user._id}
                    onClick={() => accept.mutate(user._id)}
                  >
                    Accept
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="space-y-1">
        <h3 className="t-section text-text-1">People in it</h3>
        {seated.length ? (
          <ul className="divide-y divide-line">
            {seated.map((participant) => {
              const user = actorOf(participant.user as ChallengeActor | string);
              const isHostRow = user._id === hostId;
              const items: MenuItem[] = [
                ...(isHostRow
                  ? []
                  : ([
                      {
                        label: 'Make them the host',
                        icon: <Shield size={18} />,
                        onSelect: () => setHandOver({ userId: user._id, name: nameOf(user) }),
                      },
                      {
                        label: 'Remove from challenge',
                        icon: <Users size={18} />,
                        onSelect: () => {
                          setReason('');
                          setRemoving({ userId: user._id, name: nameOf(user) });
                        },
                        danger: true,
                        divider: true,
                      },
                    ] satisfies MenuItem[])),
              ];
              return (
                <li key={user._id} className="flex items-center gap-3 py-2.5">
                  <Avatar src={user.avatar} name={nameOf(user)} size="sm" seed={user._id} />
                  <p className="t-body min-w-0 flex-1 truncate text-text-1">
                    {nameOf(user)}
                    {isHostRow ? (
                      <Badge size="sm" className="ml-1.5">
                        Host
                      </Badge>
                    ) : null}
                    {participant.state === 'accepted' ? (
                      <Badge size="sm" tone="info" className="ml-1.5">
                        Starts with it
                      </Badge>
                    ) : null}
                  </p>
                  {items.length ? <Menu items={items} label={`Manage ${nameOf(user)}`} align="end" /> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="t-body text-text-2">Nobody has joined yet. Invite your circle and the board starts counting.</p>
        )}
      </section>

      <section className="space-y-2 border-t border-line pt-4">
        <h3 className="t-section text-text-1">Close it</h3>
        <p className="t-meta">
          Ending now sets the end date to this moment. Everyone keeps the days they counted and the board becomes final.
        </p>
        <div className="flex flex-wrap gap-2">
          {canInvite ? (
            <Button variant="secondary" icon={<UserPlus size={16} />} onClick={onInvite}>
              Invite people
            </Button>
          ) : null}
          <Button variant="danger" icon={<Clock size={16} />} onClick={() => setEndOpen(true)}>
            End early
          </Button>
        </div>
      </section>

      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.name ?? 'this person'}?`}
        description="They are told, with the reason you give. Their counted days stay as their own record."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim().length === 0 || remove.isPending}
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Remove
            </Button>
          </>
        }
      >
        <Input
          label="Why"
          hint="One line. They see it."
          maxLength={140}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Modal>

      <ConfirmDialog
        open={!!handOver}
        title={`Make ${handOver?.name ?? 'them'} the host?`}
        message="They get the host's controls: invites, requests, removals and the end date. You stay in the challenge as a participant."
        confirmLabel="Hand over"
        loading={transfer.isPending}
        onCancel={() => setHandOver(null)}
        onConfirm={() => transfer.mutate()}
      />

      <ConfirmDialog
        open={endOpen}
        destructive
        title="End this challenge now?"
        message="The board becomes final and nothing more counts. Everyone keeps the days they logged."
        confirmLabel="End challenge"
        loading={end.isPending}
        onCancel={() => setEndOpen(false)}
        onConfirm={() => end.mutate()}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ the modal */

export default function ChallengeDetailV2({
  challengeId,
  onClose,
}: {
  challengeId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useAuth((s) => s.user);
  const myId = me?._id ?? '';
  const [pane, setPane] = useState<Pane>('board');
  const [period, setPeriod] = useState<BoardPeriod>('week');
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    setPane('board');
    setPeriod('week');
    setInviteOpen(false);
  }, [challengeId]);

  const detail = useQuery({
    queryKey: ['challenges', 'detail', challengeId],
    enabled: !!challengeId,
    queryFn: async (): Promise<DetailResponse> => {
      const { data } = await api.get<DetailResponse>(`/challenges/${challengeId}`);
      return data;
    },
  });

  const challenge = detail.data?.challenge;
  const seat = detail.data?.me ?? null;
  const isHost = detail.data?.isHost === true;
  const hostId = detail.data?.hostId ?? idOf(challenge?.createdBy ?? null);
  const legacy = !!challenge && isWeightScored(challenge);
  const joined = !!seat && seat.state !== 'removed' && seat.state !== 'left';

  const board = useQuery({
    queryKey: challengeKeys.board(challengeId ?? '', period, 'challenge', true),
    enabled: !!challengeId && !!challenge && !legacy,
    queryFn: () => fetchChallengeBoard(challengeId as string, { period, scope: 'challenge', around: true }),
  });

  /**
   * The fallback board. `/board` answers 403 on a `participants`-visibility
   * challenge before you join, while `/leaderboard` still answers — so the
   * board you look at before committing comes from there. Asked for only
   * once the board read has come back empty-handed.
   */
  const leaderboard = useQuery({
    queryKey: challengeKeys.leaderboard(challengeId ?? ''),
    enabled: !!challengeId && !!challenge && !legacy && board.isSuccess && board.data === null,
    queryFn: () => fetchChallengeLeaderboard(challengeId as string),
  });

  const stats = useQuery({
    queryKey: challengeKeys.stats(challengeId ?? ''),
    enabled: !!challengeId && !!challenge && !legacy,
    queryFn: () => fetchChallengeStats(challengeId as string),
  });

  const v2Stats = stats.data?.v2 ?? null;
  const boardData = board.data ?? null;
  const metric = boardData?.metric ?? challenge?.scoring?.metric ?? null;
  // A v2 row's unit is the metric's word; a v1 row keeps its own goal unit.
  const unit = challenge?.mode ? metricLabel(metric) : unitLabel(challenge?.goalUnit, challenge?.goalUnitLabel);
  const participants = v2Stats?.participantsActive ?? boardData?.participants ?? challenge?.stats?.totalParticipants ?? 0;
  const ended = !!challenge && (challenge.daysLeft === null || !!challenge.completedAt || challenge.isActive === false);
  /** The trophy rule the server uses: a seat kept to the end and at least one counted day. */
  const finished = ended && joined && (boardData?.me.score ?? 0) > 0;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['challenges'] });

  const join = useMutation({
    mutationFn: async () => {
      const { data, status } = await api.post<{ status?: string }>(`/challenges/${challengeId}/join`);
      return status === 202 || data?.status === 'requested';
    },
    onSuccess: (requested) => {
      toast.success(requested ? 'Asked to join. The host decides.' : "You're in.");
      invalidate();
    },
    onError: (e) => toast.error(mapChallengeError((e as { response?: { data?: unknown } })?.response?.data, 'Could not join the challenge').message),
  });

  const leave = useMutation({
    mutationFn: async () => {
      await api.post(`/challenges/${challengeId}/leave`);
    },
    onSuccess: () => {
      toast.info('You left the challenge');
      invalidate();
    },
    onError: (e) => toast.error(mapChallengeError((e as { response?: { data?: unknown } })?.response?.data, 'Could not leave the challenge').message),
  });

  const excludeIds = useMemo(() => {
    const set = new Set<string>();
    for (const participant of challenge?.participants ?? []) set.add(idOf(participant.user as ChallengeActor | string));
    for (const id of challenge?.invitedUsers ?? []) set.add(String(id));
    return set;
  }, [challenge?.participants, challenge?.invitedUsers]);

  /** The host always; a seated participant unless the host closed invites. */
  const canInvite = !!challenge && !ended && (isHost || (joined && challenge.settings?.allowInvites !== false));
  const full = !!challenge?.maxParticipants && participants >= challenge.maxParticipants;
  const timeLeft = daysLeftLabel(challenge?.daysLeft);

  const tabs = [
    { key: 'board', label: challenge?.mode === 'group_goal' ? 'Goal' : 'Board', icon: <Trophy size={16} /> },
    { key: 'stats', label: 'Stats', icon: <TrendingUp size={16} /> },
    { key: 'activity', label: 'Activity', icon: <Activity size={16} /> },
    { key: 'rules', label: 'Rules', icon: <Check size={16} /> },
    ...(isHost ? [{ key: 'manage', label: 'Manage', icon: <Shield size={16} />, count: challenge?.joinRequests?.length || undefined }] : []),
  ];

  return (
    <Modal
      open={!!challengeId}
      onClose={onClose}
      title={challenge?.title || 'Challenge'}
      description={
        challenge
          ? [MODE_LABEL[challenge.mode ?? ''] ?? humanize(challenge.type), metric ? metricLabel(metric) : null]
              .filter(Boolean)
              .join(' · ')
          : undefined
      }
      size="lg"
      footer={
        challenge && !detail.isLoading ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {joined ? (
                <Button variant="ghost" loading={leave.isPending} onClick={() => leave.mutate()}>
                  Leave challenge
                </Button>
              ) : null}
            </div>
            {/* One filled blue: Join while there is a seat to take, Invite once you are in. */}
            {!joined && !legacy ? (
              <Button
                variant="primary"
                size="lg"
                className="sm:[--btn-h:44px]"
                loading={join.isPending}
                disabled={ended || full}
                onClick={() => join.mutate()}
              >
                {ended ? 'Challenge ended' : full ? 'Challenge full' : 'Join challenge'}
              </Button>
            ) : canInvite ? (
              <Button variant="primary" icon={<UserPlus size={18} />} onClick={() => setInviteOpen(true)}>
                Invite people
              </Button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {detail.isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading challenge">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-11 w-full rounded-sm" />
          <ChallengeBoardSkeleton />
        </div>
      ) : detail.isError ? (
        <ErrorState error={detail.error} title="Could not load this challenge" retry={() => detail.refetch()} />
      ) : challenge ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-1.5">
            {challenge.mode ? <Badge tone="brand">{MODE_LABEL[challenge.mode] ?? humanize(challenge.mode)}</Badge> : null}
            {timeLeft ? (
              <Badge tone={daysLeftUrgent(challenge.daysLeft) ? 'accent' : ended ? 'neutral' : 'success'} dot={daysLeftUrgent(challenge.daysLeft)}>
                {daysLeftUrgent(challenge.daysLeft) ? <Flame size={12} /> : null}
                {timeLeft}
              </Badge>
            ) : null}
            {challenge.ownership === 'vybe' ? <Badge tone="info">Vybe</Badge> : challenge.ownership === 'system' ? <Badge tone="info">Official</Badge> : null}
            {joined ? (
              <Badge tone="brand">
                <Check size={12} /> You&rsquo;re in
              </Badge>
            ) : null}
          </div>

          <ChallengeAward finished={finished} to="/achievements" />

          {challenge.description ? <p className="prose-measure t-body text-text-2">{challenge.description}</p> : null}

          {legacy ? (
            <Callout tone="info" title="This challenge is no longer scored">
              Vybe does not run challenges scored on body weight.{joined ? ' You can still leave it.' : ''}
            </Callout>
          ) : (
            <>
              <SegmentedControl
                aria-label="Challenge sections"
                fill
                active={pane}
                onChange={(k) => setPane(k as Pane)}
                tabs={tabs}
              />

              {pane === 'board' ? (
                <div className="space-y-3">
                  <SegmentedControl
                    aria-label="Board period"
                    size="sm"
                    active={period}
                    onChange={(k) => setPeriod(k as BoardPeriod)}
                    tabs={BOARD_PERIODS.map((key) => ({ key, label: BOARD_PERIOD_LABELS[key] }))}
                  />
                  {board.isLoading ? (
                    <ChallengeBoardSkeleton />
                  ) : board.isError ? (
                    <ErrorState error={board.error} title="The board didn’t load" retry={() => board.refetch()} />
                  ) : boardData ? (
                    <ChallengeBoardPane board={boardData} me={me ? { _id: myId, username: me.username, fullName: me.fullName, avatar: me.avatar } : null} unit={unit} />
                  ) : leaderboard.isLoading ? (
                    <ChallengeBoardSkeleton />
                  ) : leaderboard.data?.length ? (
                    <ChallengeLeaderboardList entries={legacyBoardEntries(leaderboard.data, myId)} unit={unit} />
                  ) : (
                    /* 404 FEATURE_DISABLED or a participants-only board with
                       nothing to fall back on: the surface is absent, and the
                       reason it is absent is the one thing worth saying. */
                    <EmptyState
                      size="sm"
                      icon={<Trophy size={24} />}
                      title={joined ? 'No board yet' : 'Join to see the board'}
                      message={
                        joined
                          ? 'The board fills in as people train. A logged session is all it takes.'
                          : 'This challenge shows its board to the people in it.'
                      }
                    />
                  )}
                </div>
              ) : null}

              {pane === 'stats' ? (
                <div className="space-y-4">
                  <StatGrid columns={v2Stats ? 4 : 3}>
                    <StatTile
                      label="In it"
                      value={participants}
                      icon={<Users size={20} />}
                      loading={stats.isLoading && !v2Stats}
                      fallback="Invite your circle"
                    />
                    {v2Stats ? (
                      <StatTile
                        label={challenge.mode === 'group_goal' ? 'Together' : 'Days counted'}
                        value={v2Stats.groupTotal}
                        unit={unit || undefined}
                        icon={<Target size={20} />}
                        tone="brand"
                        fallback="Nothing yet"
                      />
                    ) : null}
                    <StatTile
                      label="Typical"
                      value={v2Stats?.medianDaysDone ?? 0}
                      unit="days"
                      icon={<Activity size={20} />}
                      loading={stats.isLoading && !v2Stats}
                      fallback="Too early"
                    />
                    <StatTile
                      label="Your days"
                      value={boardData?.me.daysDone ?? 0}
                      unit="days"
                      icon={<Check size={20} />}
                      loading={board.isLoading}
                      fallback={joined ? 'Log a session' : 'Join in'}
                    />
                  </StatGrid>
                  <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 t-meta">
                    {dayOfLine(v2Stats) ? (
                      <li className="inline-flex items-center gap-1.5 tabular">
                        <Clock size={14} /> {dayOfLine(v2Stats)}
                      </li>
                    ) : null}
                    {myShareLine(v2Stats, challenge.mode === 'group_goal' ? boardData?.groupGoal?.myPart : boardData?.me.score) ? (
                      <li className="inline-flex items-center gap-1.5 tabular">
                        <TrendingUp size={14} /> Your share:{' '}
                        {myShareLine(v2Stats, challenge.mode === 'group_goal' ? boardData?.groupGoal?.myPart : boardData?.me.score)}
                      </li>
                    ) : null}
                    <li className="inline-flex items-center gap-1.5">
                      <Calendar size={14} /> {formatChallengeWindow(challenge.startDate, challenge.endDate)}
                    </li>
                  </ul>
                </div>
              ) : null}

              {pane === 'activity' ? (
                <div className="space-y-4">
                  <SegmentedControl
                    aria-label="Activity period"
                    size="sm"
                    active={period}
                    onChange={(k) => setPeriod(k as BoardPeriod)}
                    tabs={BOARD_PERIODS.map((key) => ({ key, label: BOARD_PERIOD_LABELS[key] }))}
                  />
                  {board.isLoading ? (
                    <Skeleton className="h-24 w-full rounded-md" />
                  ) : boardData && (boardData.me.daysDone > 0 || boardData.me.score > 0) ? (
                    <div>
                      <p className="t-metric text-text-1">{formatStat(boardData.me.score)}</p>
                      <p className="t-meta">
                        {unit}
                        {boardData.me.daysDone > 0
                          ? ` from ${formatStat(boardData.me.daysDone)} ${boardData.me.daysDone === 1 ? 'day' : 'days'}`
                          : ''}
                        {boardData.range.key === 'all' ? ' over the whole challenge' : ''}
                      </p>
                    </div>
                  ) : (
                    <EmptyState
                      size="sm"
                      icon={<Activity size={24} />}
                      title={joined ? 'Nothing counted in this period' : 'Join to start counting'}
                      message={
                        joined
                          ? 'Save a session and it lands here — there is nothing to enter by hand.'
                          : 'Once you are in, every session you log counts towards this challenge.'
                      }
                      action={joined ? { label: 'Log a session', to: '/workouts/session', variant: 'secondary' } : undefined}
                    />
                  )}
                  {/* The trust rule, where the number is: what counts, and that
                      nobody types it in. */}
                  <Callout tone="brand" icon={<Shield size={20} className="text-brand" />} title="How this is counted">
                    {trustRuleFor({ metric, dailyCap: boardData?.dailyCap ?? challenge.scoring?.dailyCap ?? null })}
                    {boardData?.range.resetsOn === 'monday' && boardData.range.key !== 'all'
                      ? ' Weeks start on Monday in the challenge’s time zone.'
                      : ''}
                  </Callout>
                </div>
              ) : null}

              {pane === 'rules' ? (
                <dl className="divide-y divide-line">
                  <RuleRow term="Scoring">
                    {trustRuleFor({ metric, dailyCap: boardData?.dailyCap ?? challenge.scoring?.dailyCap ?? null })}
                  </RuleRow>
                  <RuleRow term="Shape">
                    {challenge.mode === 'group_goal'
                      ? `Everyone's days pool towards ${formatStat(challenge.goal)}${unit ? ` ${unit}` : ''}. No ranks.`
                      : `A leaderboard, ranked by ${unit || 'what counts'}. Equal scores share a place.`}
                  </RuleRow>
                  <RuleRow term="Proof">{PROOF_LINE[boardData?.proof ?? challenge.scoring?.proof ?? 'none'] ?? PROOF_LINE.none}</RuleRow>
                  <RuleRow term="Window">
                    {formatChallengeWindow(challenge.startDate, challenge.endDate)}
                    {challenge.timezone ? ` · ${challenge.timezone}` : ''}
                    {timeLeft ? ` · ${timeLeft}` : ''}
                  </RuleRow>
                  <RuleRow term="Joining">
                    {challenge.settings?.joinPolicy === 'approval'
                      ? 'The host approves each request.'
                      : 'Anyone who can see it can join.'}
                    {challenge.maxParticipants ? ` Up to ${formatStat(challenge.maxParticipants)} people.` : ''}
                  </RuleRow>
                  <RuleRow term="Who sees it">{VISIBILITY_LINE[challenge.visibility ?? 'participants'] ?? VISIBILITY_LINE.participants}</RuleRow>
                  {challenge.rewards ? <RuleRow term="Rewards">{challenge.rewards}</RuleRow> : null}
                </dl>
              ) : null}

              {pane === 'manage' && isHost ? (
                <ManagePane challenge={challenge} hostId={hostId} canInvite={canInvite} onInvite={() => setInviteOpen(true)} />
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {challenge ? (
        <ChallengeInviteDialog
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          challengeId={challenge._id}
          challengeTitle={challenge.title}
          excludeIds={excludeIds}
          meId={myId}
        />
      ) : null}
    </Modal>
  );
}

function RuleRow({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className={cx('grid gap-0.5 py-3 sm:grid-cols-[8rem_1fr] sm:gap-4')}>
      <dt className="t-meta font-semibold text-text-1">{term}</dt>
      <dd className="t-body text-text-2">{children}</dd>
    </div>
  );
}
