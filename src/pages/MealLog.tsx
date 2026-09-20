import { useLocation, useNavigate } from 'react-router-dom';
import { RouteSheet } from '../components/RouteSheet';
import { LogMealForm } from './Meals';

/**
 * /meals/log — the meal logger as a route. Opened from the Fuel band's
 * "Log meal", the phone top bar, the Log sheet (`/meals?log=1` forwards
 * here) and the manifest shortcut. The shell presents it as a sheet over the
 * Meals page on `lg+` (`location.state.backgroundLocation`) and as a full
 * page on phones; browser back closes it either way.
 */
export default function MealLog() {
  const navigate = useNavigate();
  const location = useLocation();
  const close = () => {
    const bg = (location.state as { backgroundLocation?: unknown } | null)?.backgroundLocation;
    // Opened over a parent: back pops the sheet. Landed here cold (a shortcut,
    // a refresh): there is nothing under it, so go to the Meals hub instead.
    if (bg && (window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate('/meals', { replace: true });
  };
  return (
    <RouteSheet title="Log a meal" onClose={close}>
      <LogMealForm onDone={close} onCancel={close} />
    </RouteSheet>
  );
}
