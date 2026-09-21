import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TRAIN, type ProgramSlotParam } from './sheet';
import {
  fetchEnrollments,
  isFeatureDisabled,
  programKeys,
  programsFeature,
  type EnrollmentListItem,
} from '../../lib/programs';

/**
 * The member's programmes, read once for the whole Train hub.
 *
 * Two surfaces share the answer. The hub's one prominent button reads
 * "Continue {plan} · Week n · Day d" while a programme is running (Garmin
 * Coach / Runna: the programme state is a fraction plus one next-up line),
 * and every Programs row carries "Enrolled · Week 2 of 4" in its meta. One
 * query key, so the button and the rows can never disagree.
 *
 * The whole /api/plans router sits behind the `programs` flag and answers 404
 * while it is off, so the read is gated on the flag and a FEATURE_DISABLED
 * answer is not retried: nothing to continue, no error, the button keeps its
 * default label and the rows keep their ordinary meta.
 */

/** Open and finished alike: a finished plan still says so on its row. */
export const ENROLLMENT_STATUSES = 'active,paused,completed';

export const ENROLLMENT_KEY = programKeys.enrollments(ENROLLMENT_STATUSES);

export type EnrolmentIndex = {
  items: EnrollmentListItem[];
  /** planId → the member's enrolment on it. */
  byPlan: Map<string, EnrollmentListItem>;
  isPending: boolean;
};

/** Every enrolment the member holds, indexed by plan. Empty while the flag is off. */
export function useEnrolments(): EnrolmentIndex {
  const { programs } = programsFeature();
  const query = useQuery({
    queryKey: ENROLLMENT_KEY,
    queryFn: () => fetchEnrollments(ENROLLMENT_STATUSES, 50),
    enabled: programs,
    staleTime: 60_000,
    retry: (count, error) => !isFeatureDisabled(error) && count < 2,
  });
  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const byPlan = useMemo(() => {
    const map = new Map<string, EnrollmentListItem>();
    for (const item of items) if (item.plan?._id) map.set(item.plan._id, item);
    return map;
  }, [items]);
  return { items, byPlan, isPending: query.isPending && programs };
}

export type ContinueProgram = {
  /** "Continue Strength Builder · Week 2 · Day 3" */
  label: string;
  workoutId: string;
  /** The slot the session counts toward, so the recap can mark it done. */
  program: ProgramSlotParam;
  /** The runner, seeded from the pointer's workout and carrying its slot. */
  to: string;
};

/**
 * The one programme the hub offers to continue: the running one, at the first
 * slot that is neither done nor skipped. A paused plan is not offered — the
 * member paused it — and a finished one has no pointer.
 */
export function continueProgramOf(items: readonly EnrollmentListItem[]): ContinueProgram | null {
  const active = items.find((item) => item.enrollment?.status === 'active' && item.pointer?.workoutId && item.plan) ?? null;
  const pointer = active?.pointer;
  const plan = active?.plan;
  if (!pointer?.workoutId || !plan) return null;
  const program: ProgramSlotParam = { planId: plan._id, week: pointer.week, day: pointer.day, order: pointer.order };
  return {
    label: `Continue ${plan.title} · Week ${pointer.week} · Day ${pointer.day}`,
    workoutId: pointer.workoutId,
    program,
    to: TRAIN.liveSession({ from: pointer.workoutId, program }),
  };
}

/**
 * The label is built from the enrolment alone: one read, one relabel of a
 * button that already exists, no second line arriving late under it (a
 * "Next up" line that filled in after the rows had painted measured CLS 0.24).
 */
export function useContinueProgram(): ContinueProgram | null {
  const { items } = useEnrolments();
  return useMemo(() => continueProgramOf(items), [items]);
}
