import { Button } from '../ui';
import { SettingsCard } from '../SettingsPieces';
import {
  PUSH_DEVICE_COPY,
  PUSH_DEVICE_TITLE,
  usePushDevice,
  type PushDevice,
} from '../../lib/pushDevice';
import type { PushSupport } from '../../lib/firebase';

/**
 * "Notifications on this device", the first card under Settings ›
 * Notifications.
 *
 * It sits above the 18 switches because those are preferences about pushes
 * this browser could not receive at all until now: the API has sent through
 * FCM all along, the web simply never registered a token. The switches say
 * what Vybe may send; this card says whether this browser will get it.
 *
 * Presentational — every value arrives as a prop — so all five states render
 * under react-dom/server in the test.
 */
export function PushDeviceCard({ state, busy, onEnable, onDisable }: {
  state: PushSupport;
  busy?: boolean;
  onEnable: () => void;
  onDisable: () => void;
}) {
  return (
    <SettingsCard id="push-device" title={PUSH_DEVICE_TITLE}>
      {state === 'default' ? (
        <div className="space-y-3">
          <p className="t-body text-text-2">{PUSH_DEVICE_COPY.default.line}</p>
          {/* The one blue on this card: the single thing to do here. */}
          <Button variant="primary" loading={busy} onClick={onEnable}>
            {PUSH_DEVICE_COPY.default.action}
          </Button>
        </div>
      ) : null}

      {state === 'granted' ? (
        <div className="flex min-h-11 items-center gap-4">
          <p className="t-body min-w-0 flex-1 text-text-1">{PUSH_DEVICE_COPY.granted.line}</p>
          {/* Quiet: turning notifications off is not the action this card is for. */}
          <Button variant="quiet" size="sm" loading={busy} onClick={onDisable}>
            {PUSH_DEVICE_COPY.granted.action}
          </Button>
        </div>
      ) : null}

      {state === 'denied' ? <p className="t-body text-text-2">{PUSH_DEVICE_COPY.denied.line}</p> : null}

      {state === 'unsupported' ? <p className="t-body text-text-2">{PUSH_DEVICE_COPY.unsupported.line}</p> : null}

      {state === 'needs-install' ? (
        <div className="space-y-1">
          <p className="t-body text-text-1">{PUSH_DEVICE_COPY['needs-install'].line}</p>
          <p className="t-meta">{PUSH_DEVICE_COPY['needs-install'].how}</p>
        </div>
      ) : null}
    </SettingsCard>
  );
}

/** The card wired to the browser. */
export function PushDeviceSection() {
  const device: PushDevice = usePushDevice();
  return <PushDeviceCard state={device.state} busy={device.busy} onEnable={device.enable} onDisable={device.disable} />;
}
