import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

/**
 * The hub's one prominent button reads "Continue {plan} · Week n · Day d"
 * while the member is enrolled in a programme (Garmin Coach / Runna: the
 * programme state is a fraction plus one next-up line). The whole
 * /api/plans router sits behind the `programs` flag and answers 404 while it
 * is off, so the read is feature-detected: 404 and 403 mean "nothing to
 * continue", never an error, and the button simply keeps its default label.
 * Literal request path on purpose — scripts/audit-api-contracts.cjs pins it.
 */

export type EnrollmentPointer = { week: number; day: number; order: number; workoutId: string };

export type ActiveEnrollment = {
  enrollment: { _id?: string; status: string };
  plan: { _id: string; title: string; durationWeeks?: number };
  pointer: EnrollmentPointer | null;
  progress?: { done: number; skipped: number; total: number; ratio: number };
  suggestedWeek?: number | null;
};

export const ENROLLMENT_KEY = ['plans', 'enrollments', 'active'] as const;

const statusOf = (e: unknown): number | undefined => (e as { response?: { status?: number } } | null)?.response?.status;

/** The member's one active programme, or null — including when the flag is off (404) or the read is refused (403). */
export async function fetchActiveEnrollment(): Promise<ActiveEnrollment | null> {
  try {
    const { data } = await api.get<{ items?: ActiveEnrollment[] }>('/plans/enrollments', { params: { status: 'active', limit: 1 } });
    return data?.items?.[0] ?? null;
  } catch (e) {
    const status = statusOf(e);
    if (status === 404 || status === 403) return null;
    throw e;
  }
}

export type ContinueProgram = {
  /** "Continue Strength Builder · Week 2 · Day 3" */
  label: string;
  workoutId: string;
};

/**
 * The label is built from the enrolment alone: one read, one relabel of a
 * button that already exists, no second line arriving late under it (a
 * "Next up" line that filled in after the rows had painted measured CLS 0.24).
 */
export function useContinueProgram(): ContinueProgram | null {
  const enrollment = useQuery({ queryKey: ENROLLMENT_KEY, queryFn: fetchActiveEnrollment, staleTime: 60_000, retry: false });
  const active = enrollment.data ?? null;
  const pointer = active?.pointer ?? null;
  if (!active || !pointer?.workoutId) return null;
  return {
    label: `Continue ${active.plan.title} · Week ${pointer.week} · Day ${pointer.day}`,
    workoutId: pointer.workoutId,
  };
}
