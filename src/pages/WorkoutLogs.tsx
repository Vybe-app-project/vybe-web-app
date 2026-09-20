/**
 * Compatibility shim: the page is now src/pages/WorkoutHistory.tsx at
 * /workouts/history. The shell package repoints App.tsx and redirects
 * /workouts/logs there; until that lands this keeps the old import working.
 * Delete at integration.
 */
export { default } from './WorkoutHistory';
