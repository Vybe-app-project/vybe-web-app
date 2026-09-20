import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Modal, PageHeader, useMediaQuery } from './ui';

/**
 * PLACEHOLDER — the shell package (P2) owns the real RouteSheet with this
 * exact export and signature; the integrator keeps P2's file. This copy only
 * lets the Train pages typecheck and run in isolation: a route rendered as a
 * sheet over its parent on `lg+` when `location.state.backgroundLocation` is
 * set, and as a full page otherwise. Escape and browser back both close it.
 */
export function RouteSheet({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const wide = useMediaQuery('(min-width: 1024px)');
  const background = (location.state as { backgroundLocation?: unknown } | null)?.backgroundLocation;
  const close = onClose ?? (() => (background ? navigate(-1) : navigate('..', { viewTransition: true })));
  if (wide && background) {
    return (
      <Modal open title={title} onClose={close} size="lg" presentation="dialog">
        {children}
      </Modal>
    );
  }
  return (
    <div className="space-y-section">
      <PageHeader title={title} back />
      {children}
    </div>
  );
}
