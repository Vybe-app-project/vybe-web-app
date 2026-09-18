import type { ReactNode } from 'react';
import { Callout, Card } from './ui';

/**
 * The one honest "this server does not offer this feature" state, shared by
 * every capability-gated page. Same structure and classes as the livestream
 * page's `LiveUnavailable`: a centred card that names the server setting as
 * the cause, so users never troubleshoot their own device for it.
 */
export function CapabilityDisabled({
  icon,
  title,
  message,
  callout,
  actions,
}: {
  /** Glyph in the brand-soft medallion, e.g. `<Radio size={32} />`. */
  icon: ReactNode;
  /** `h2` heading, e.g. "Live video is not enabled here". */
  title: string;
  /** Feature-specific sentence; the honest "server setting" tail is appended. */
  message: string;
  /** Optional deep-link explainer shown above the card (cf. LiveUnavailable). */
  callout?: { title: ReactNode; message: ReactNode };
  /** Centred row of links/buttons, e.g. fallback destinations. */
  actions?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      {callout ? (
        <Callout tone="info" title={callout.title}>
          {callout.message}
        </Callout>
      ) : null}
      <Card className="flex flex-col items-center gap-5 py-12 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-soft text-brand-text">
          {icon}
        </span>
        <div className="max-w-md space-y-2">
          <h2 className="type-heading text-xl text-text-1">{title}</h2>
          <p className="text-base leading-relaxed text-text-2">
            {message} It is a server setting, not something on your device, and the rest of the app is unaffected.
          </p>
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div>
        ) : null}
      </Card>
    </div>
  );
}
