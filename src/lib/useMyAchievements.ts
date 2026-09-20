import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Achievement, AchievementListResponse } from './achievements';

/**
 * The member's whole achievement set (GET /achievements/user, unfiltered).
 * One query key, one data shape: the Achievements page tiles, its catalogue
 * merge and the Profile shortcut all read this list, and each picks what it
 * needs through `select`. Two hooks writing different shapes under this key
 * made Profile → Achievements render `summary.filter` on an object.
 */
export const MY_ACHIEVEMENTS_KEY = ['achievements', 'user', 'summary'] as const;

/** utils/localDate.js expects Date#getTimezoneOffset's sign (UTC minus local). */
const tzOffset = () => new Date().getTimezoneOffset();

export async function fetchMyAchievements(): Promise<Achievement[]> {
  const { data } = await api.get<AchievementListResponse>('/achievements/user', {
    params: { timezoneOffsetMinutes: tzOffset() },
  });
  return data.achievements ?? [];
}

export function useMyAchievements<T = Achievement[]>(select?: (rows: Achievement[]) => T) {
  return useQuery({
    queryKey: ['achievements', 'user', 'summary'],
    staleTime: 5 * 60_000,
    queryFn: fetchMyAchievements,
    select,
  });
}
