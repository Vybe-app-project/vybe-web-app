import { useEffect, useState } from 'react';
import { Button, Input, Select } from './ui';
import { restRemaining, type RestTimer } from '../lib/workoutDrafts';

export function WorkoutRestTimer({ timer, onChange, exercises }: {
  timer: RestTimer; onChange: (next: RestTimer) => void; exercises: Array<{ exerciseId: string; name: string }>;
}) {
  const [now, setNow] = useState(Date.now);
  const [seconds, setSeconds] = useState(String(timer.durationSeconds));
  const [error, setError] = useState('');
  useEffect(() => {
    const update = () => setNow(Date.now());
    const interval = window.setInterval(update, 1000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(interval); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  const remaining = restRemaining(timer, now);
  const status = timer.deadline !== null ? remaining === 0 ? 'Rest finished' : 'Rest timer running'
    : timer.pausedSeconds !== null ? 'Rest timer paused' : 'Rest timer stopped';
  const applyDuration = () => {
    const duration = Number(seconds);
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > 86400) {
      setError('Enter a rest duration from 1 to 86400 seconds.'); return null;
    }
    setError('');
    return duration;
  };
  return (
    <fieldset className="space-y-3 rounded-md border border-border-1 p-3">
      <legend className="px-1 text-sm font-semibold text-text-1">Optional rest timer</legend>
      <p className="text-xs text-text-2">Choose your own duration. This device only; no background notifications.</p>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Rest seconds" type="number" min={1} max={86400} step={1} value={seconds}
          onChange={event => {
            setSeconds(event.target.value);
            const duration = Number(event.target.value);
            if (Number.isSafeInteger(duration) && duration >= 1 && duration <= 86400) onChange({ ...timer, durationSeconds: duration });
          }} />
        <Select label="Rest timer for" value={timer.scope}
          options={[{ value: 'Session', label: 'Session' }, ...exercises.map(ex => ({ value: ex.exerciseId, label: ex.name || 'Unnamed exercise' }))]}
          onChange={scope => onChange({ ...timer, scope })} />
      </div>
      <p role="timer" aria-live="off" aria-label="Rest time remaining" className="text-lg tabular-nums text-text-1">
        {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
      </p>
      <p role="status" className="text-sm text-text-2">{status}</p>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => {
          const duration = applyDuration();
          if (duration === null) return;
          const time = timer.pausedSeconds ?? duration;
          onChange({ ...timer, durationSeconds: duration, deadline: Date.now() + time * 1000, pausedSeconds: null });
          setNow(Date.now());
        }} disabled={timer.deadline !== null && remaining > 0}>{timer.pausedSeconds !== null ? 'Resume rest' : 'Start rest'}</Button>
        <Button type="button" variant="ghost" disabled={timer.deadline === null || remaining === 0}
          onClick={() => onChange({ ...timer, deadline: null, pausedSeconds: restRemaining(timer) })}>Pause rest</Button>
        <Button type="button" variant="ghost" onClick={() => {
          const duration = applyDuration();
          if (duration !== null) onChange({ ...timer, durationSeconds: duration, deadline: null, pausedSeconds: duration });
        }}>Reset rest</Button>
        <Button type="button" variant="ghost" onClick={() => onChange({ ...timer, deadline: null, pausedSeconds: null })}>Stop rest</Button>
      </div>
    </fieldset>
  );
}
