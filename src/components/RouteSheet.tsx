import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { Modal, PageHeader, useMediaQuery } from './ui';
import type { ModalSize } from './ui';

/**
 * A route presented as a sheet over its parent on `lg+`, and as a plain page
 * on phones (and on any direct load, where there is no parent to sit over).
 *
 *   /workouts ──Link state={sheetState(location)}──▶ /workouts/new
 *
 * The link that opens a detail route records where it came from in
 * `location.state.backgroundLocation`. App.tsx keeps rendering that background
 * location in the main <Routes> while the sheet's own route renders here, so
 * the parent stays under the dialog; Escape, the close button, the backdrop and
 * the browser's Back all pop the history entry and the sheet is gone. Focus is
 * trapped inside the dialog and restored to the opener by <Modal>.
 *
 * Without a background location (phone, deep link, reload) the same children
 * render as the page body under the shell's back-chevron bar, so the URL is
 * always a complete, shareable screen.
 *
 * Page modules wrap their body in this and do NOT call <PageHeader> themselves;
 * the sheet owns the title in both presentations.
 */

export type BackgroundLocation = Pick<Location, 'pathname' | 'search' | 'hash'>;

/** Router state to put on a Link/navigate that should open its destination as a sheet over the current screen. */
export function sheetState(location: Location): { backgroundLocation: BackgroundLocation } {
  return { backgroundLocation: { pathname: location.pathname, search: location.search, hash: location.hash } };
}

export function backgroundLocationOf(location: Location): BackgroundLocation | null {
  const state = location.state as { backgroundLocation?: BackgroundLocation } | null | undefined;
  const bg = state?.backgroundLocation;
  return bg && typeof bg.pathname === 'string' ? bg : null;
}

/** `lg` — the width from which a detail route sits over its parent instead of replacing it. */
export const SHEET_MEDIA = '(min-width: 64rem)';

export function useSheetPresentation(): { asSheet: boolean; background: BackgroundLocation | null } {
  const location = useLocation();
  const wide = useMediaQuery(SHEET_MEDIA);
  const background = backgroundLocationOf(location);
  return { asSheet: wide && !!background, background };
}

export type RouteSheetProps = {
  title: string;
  description?: string;
  /** Where the page presentation's back chevron goes when there is no history (defaults to the route's parent). */
  backTo?: string;
  size?: ModalSize;
  /** Header actions in the page presentation (desktop header / phone top bar). */
  actions?: ReactNode;
  /** Sticky footer in the sheet presentation. */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
};

function SheetPresentation({ title, description, size = 'lg', footer, className, children }: RouteSheetProps) {
  const navigate = useNavigate();
  const close = useCallback(() => navigate(-1), [navigate]);
  return (
    <Modal open onClose={close} presentation="dialog" size={size} title={title} description={description} footer={footer} className={className}>
      {children}
    </Modal>
  );
}

function PagePresentation({ title, description, backTo, actions, footer, children }: RouteSheetProps) {
  return (
    <>
      <PageHeader title={title} subtitle={description} back={backTo ?? true} actions={actions} hideSectionTabs />
      {children}
      {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
    </>
  );
}

export function RouteSheet(props: RouteSheetProps) {
  const { asSheet } = useSheetPresentation();
  return asSheet ? <SheetPresentation {...props} /> : <PagePresentation {...props} />;
}

export default RouteSheet;
