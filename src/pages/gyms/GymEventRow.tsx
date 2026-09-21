import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errMsg } from '../../lib/api';
import { saveBlob } from '../../lib/portability';
import {
  type Actor,
  type EventInsights,
  type MyRsvp,
  type RsvpStatus,
  absentOnRefusal,
  fetchEventIcs,
  fetchEventInsights,
  gymV2Keys,
  leaveRsvp,
  saveRsvp,
} from '../../lib/gymCommunityV2';
import { useReportModal } from '../Report';
import { Avatar, Badge, Button, Menu, Skeleton, cx, formatStat, useToast } from '../ui';
import { Calendar, Check, Download, Flag, X } from '../icons';

/**
 * One planned session, with the three things a member does with it: say they
 * are going, see who else is, and put it in their own calendar
 * (docs/api-contract.md, "Gym community events, RSVP, reminders and .ics").
 *
 * RSVP is `PUT /gyms/events/:eventId/rsvp { status: 'going' | 'not_going' }`,
 * idempotent, and the answer carries the new counts — so the row reads them
 * back rather than guessing. A full event with a waitlist answers
 * `status: 'waitlist'`, which the row says plainly.
 *
 * The `.ics` route is bearer-only (D-54: event ids are enumerable, so there
 * is no signed public link), so "Add to calendar" is a blob read through the
 * one client and handed to the browser, like the CSV export.
 *
 * Organiser insights (`GET /insights`, admins and moderators) are one line
 * and only where the route answers: a 404 or a 403 leaves it out.
 */

export type GymEvent = {
  _id: string;
  title?: string;
  description?: string;
  startsAt?: string;
  startsAtLocal?: { time?: string; date?: string } | string;
  timezone?: string;
  goingCount?: number;
  waitlistCount?: number;
  spotsLeft?: number | null;
  capacity?: number | null;
  isFull?: boolean;
  status?: 'scheduled' | 'cancelled' | string;
  cancelReason?: string;
  locationNote?: string;
  canManage?: boolean;
  attendeesPreview?: (Actor & { isMutual?: boolean })[];
  /** `null`, the RSVP object, or one of the legacy string/boolean spellings the list used to send. */
  myRsvp?: MyRsvp | string | boolean | null;
};

/** The viewer's own status, whichever spelling the payload used. */
export function rsvpStatusOf(event: Pick<GymEvent, 'myRsvp'>): RsvpStatus {
  const mine = event.myRsvp;
  if (!mine) return 'none';
  if (mine === true) return 'going';
  if (typeof mine === 'string') return mine === 'going' || mine === 'yes' ? 'going' : mine === 'waitlist' ? 'waitlist' : 'none';
  const status = mine.status;
  return status === 'going' || status === 'waitlist' ? status : 'none';
}

/** "3 going", "Full", "2 spots left": only what the payload actually says. */
export function capacityLine(event: GymEvent): string | null {
  if (event.isFull === true) return 'Full';
  const spots = typeof event.spotsLeft === 'number' && event.spotsLeft > 0 ? event.spotsLeft : null;
  if (spots === null) return null;
  return spots === 1 ? '1 spot left' : `${spots} spots left`;
}

/** "12 going · 9 turned up · 2 walk-ins", and last time's turnout when the API knows it. */
export function insightsLine(insights?: EventInsights | null): string | null {
  if (!insights) return null;
  const parts: string[] = [];
  if (typeof insights.going === 'number' && insights.going > 0) parts.push(`${formatStat(insights.going)} going`);
  if (typeof insights.waitlisted === 'number' && insights.waitlisted > 0) parts.push(`${formatStat(insights.waitlisted)} waiting`);
  if (typeof insights.attended === 'number' && insights.attended > 0) parts.push(`${formatStat(insights.attended)} turned up`);
  if (typeof insights.walkIns === 'number' && insights.walkIns > 0) parts.push(`${formatStat(insights.walkIns)} walked in`);
  const previous = insights.previous;
  if (previous && typeof previous.attended === 'number' && previous.attended > 0) {
    parts.push(`${formatStat(previous.attended)} last time`);
  }
  return parts.length ? parts.join(' · ') : null;
}

function AttendeeFaces({ people, goingCount, label }: { people: (Actor & { isMutual?: boolean })[]; goingCount?: number; label: string }) {
  const faces = people.filter((p) => p?._id).slice(0, 4);
  const going = typeof goingCount === 'number' && goingCount > 0 ? goingCount : 0;
  if (!faces.length && !going) return null;
  const rest = going - faces.length;
  return (
    <div className="mt-1.5 flex items-center gap-2">
      {faces.length ? (
        <ul className="flex -space-x-2" aria-label={label}>
          {faces.map((p) => (
            <li key={p._id}>
              <Link to={`/u/${p._id}`} viewTransition aria-label={p.fullName || p.username || 'Member'} className="pressable block rounded-full ring-2 ring-bg">
                <Avatar src={p.avatar} name={p.fullName || p.username || 'Member'} size={28} seed={p._id} />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {going ? (
        <span className="t-meta">
          {faces.length && rest > 0
            ? `and ${formatStat(rest)} more going`
            : going === 1
              ? '1 going'
              : `${formatStat(going)} going`}
        </span>
      ) : null}
    </div>
  );
}

export function GymEventRow({
  event,
  communityId,
  when,
  member,
  className,
}: {
  event: GymEvent;
  communityId: string;
  /** The session's time in the gym's own zone, drawn by the caller. */
  when: string;
  /** A non-member may read a public session's card but cannot RSVP. */
  member: boolean;
  className?: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { report, reportModal } = useReportModal();
  const [downloading, setDownloading] = useState(false);
  const status = rsvpStatusOf(event);
  const cancelled = event.status === 'cancelled';
  const capacity = capacityLine(event);

  const insights = useQuery<EventInsights | null>({
    queryKey: gymV2Keys.eventInsights(event._id),
    enabled: event.canManage === true,
    retry: false,
    staleTime: 60_000,
    queryFn: () => absentOnRefusal(() => fetchEventInsights(event._id)),
  });
  const insightLine = insightsLine(insights.data);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['community', communityId, 'events'] });
    qc.invalidateQueries({ queryKey: gymV2Keys.eventAttendees(event._id) });
    qc.invalidateQueries({ queryKey: gymV2Keys.eventInsights(event._id) });
  };

  const rsvp = useMutation({
    mutationFn: (next: 'going' | 'not_going') => (next === 'going' ? saveRsvp(event._id, { status: 'going' }) : leaveRsvp(event._id)),
    onSuccess: (result) => {
      if (result.status === 'waitlist') toast.info('The session is full — you are on the waitlist and will be told if a place opens.');
      else if (result.status === 'going') toast.success('You are going');
      else toast.info('You are not going');
      refresh();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not save your answer')),
  });

  const addToCalendar = async () => {
    setDownloading(true);
    try {
      const { blob, fileName } = await fetchEventIcs(event._id);
      saveBlob(blob, fileName);
    } catch (e) {
      toast.error(errMsg(e, 'Could not build the calendar file'));
    } finally {
      setDownloading(false);
    }
  };

  const going = status === 'going';
  const waitlisted = status === 'waitlist';
  return (
    <li className={cx('flex items-start gap-3 py-3', className)}>
      <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-text-2">
        <Calendar size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-1">{event.title || 'Session'}</p>
        {when ? <p className="text-xs text-text-2">{when}</p> : null}
        {event.locationNote ? <p className="truncate text-xs text-text-3">{event.locationNote}</p> : null}
        {cancelled ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="danger">Cancelled</Badge>
            {event.cancelReason ? <span className="t-meta truncate">{event.cancelReason}</span> : null}
          </div>
        ) : (
          <>
            {going || waitlisted || capacity ? (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {going ? (
                  <Badge tone="brand">
                    <Check size={12} />
                    You’re going
                  </Badge>
                ) : null}
                {waitlisted ? <Badge tone="warning">You’re on the waitlist</Badge> : null}
                {capacity ? <Badge tone={capacity === 'Full' ? 'warning' : 'neutral'}>{capacity}</Badge> : null}
              </div>
            ) : null}
            <AttendeeFaces people={event.attendeesPreview || []} goingCount={event.goingCount} label={`Going to ${event.title || 'this session'}`} />
            {insights.isLoading ? <Skeleton className="mt-1.5 h-3 w-40" /> : insightLine ? <p className="t-meta mt-1.5">{insightLine}</p> : null}
            {member ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Check size={16} />}
                  loading={rsvp.isPending && rsvp.variables === 'going'}
                  disabled={rsvp.isPending || going}
                  onClick={() => rsvp.mutate('going')}
                >
                  {going ? 'Going' : waitlisted ? 'Take a place' : 'Going'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<X size={16} />}
                  loading={rsvp.isPending && rsvp.variables === 'not_going'}
                  disabled={rsvp.isPending || status === 'none'}
                  onClick={() => rsvp.mutate('not_going')}
                >
                  Can’t
                </Button>
                <Button variant="quiet" size="sm" icon={<Download size={16} />} loading={downloading} onClick={() => void addToCalendar()}>
                  Add to calendar
                </Button>
              </div>
            ) : (
              <div className="mt-2">
                <Button variant="quiet" size="sm" icon={<Download size={16} />} loading={downloading} onClick={() => void addToCalendar()}>
                  Add to calendar
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      <Menu
        items={[{ label: 'Report event', icon: <Flag size={18} />, danger: true, onSelect: () => report({ targetType: 'event', targetId: event._id, targetLabel: 'event' }) }]}
        label={`Options for ${event.title || 'this session'}`}
        size={40}
        className="-mr-2 shrink-0"
      />
      {reportModal}
    </li>
  );
}
