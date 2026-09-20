import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Modal, PageHeader, useMediaQuery } from './ui';

/**
 * PLACEHOLDER — the shell package (P2) owns the real RouteSheet; the
 * integrator keeps P2's file and drops this one. Same export and signature so
 * page modules written against it compile: a sheet over the parent route on
 * `lg+` (the parent is rendered from `location.state.backgroundLocation`), a
 * full page on phones. Browser back closes it.
 */
export function RouteSheet({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const large = useMediaQuery('(min-width: 1024px)');
  const close =
    onClose ??
    (() => {
      const bg = (location.state as { backgroundLocation?: unknown } | null)?.backgroundLocation;
      if (bg) navigate(-1);
      else navigate('..', { replace: true });
    });
  if (large) {
    return (
      <Modal open onClose={close} title={title} size="md" presentation="dialog">
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

export default RouteSheet;
