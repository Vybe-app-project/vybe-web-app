import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, parseApiError } from '../../lib/api';
import {
  DEFAULT_EMAIL_SETTINGS,
  EMAIL_LABELS,
  EMAIL_PAUSE_LABEL,
  EMAIL_SETTING_KEYS,
  pickEmailSettings,
  type EmailSettingKey,
  type EmailSettings,
} from '../../lib/hooks';
import { Button, Callout, ErrorState, Skeleton, useToast } from '../ui';
import { SettingsCard, ToggleRow } from '../SettingsPieces';

/**
 * E-mail preferences: GET/PUT /users/email-preferences. Its own store on the
 * API (settings.emailNotifications plus settings.emailPaused), so nothing
 * here touches a push switch and nothing on the push card touches this.
 *
 * The card is a draft: a member flips a few switches and saves once; the body
 * carries only the keys that changed. The pure EmailPreferencesCard renders
 * under react-dom/server for tests/email-preferences-card.render.test.mjs; the
 * default export binds it to the query.
 */

export const EMAIL_SETTINGS_KEY = ['email-preferences'] as const;

export type EmailPreferences = {
  settings: EmailSettings;
  /** Stops every kind; sign-in codes, password resets and account notices still arrive. */
  emailPaused: boolean;
  /** `capabilities.emailDelivery` from the API: false on a host without SMTP. */
  emailDelivery: boolean;
};

const CARD_TITLE = 'Email preferences';
const CARD_DESCRIPTION = 'Which of these updates you also receive by e-mail. Separate from push notifications.';

/** Read the GET or PUT body. A body without `capabilities` (an older API) is read as delivering. */
export function pickEmailPreferences(data: unknown): EmailPreferences {
  const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const capabilities = (body.capabilities && typeof body.capabilities === 'object' ? body.capabilities : {}) as Record<string, unknown>;
  return {
    settings: pickEmailSettings(body.settings && typeof body.settings === 'object' ? body.settings : body),
    emailPaused: body.emailPaused === true,
    emailDelivery: capabilities.emailDelivery !== false,
  };
}

export const DEFAULT_EMAIL_PREFERENCES: EmailPreferences = {
  settings: DEFAULT_EMAIL_SETTINGS,
  emailPaused: false,
  emailDelivery: true,
};

export type EmailPreferencesCardProps = {
  value: EmailSettings;
  emailPaused: boolean;
  emailDelivery: boolean;
  dirty: boolean;
  saving?: boolean;
  /** A 400 from the API, shown under the rows while the draft is kept. */
  error?: string | null;
  onToggle: (key: EmailSettingKey, next: boolean) => void;
  onTogglePause: (next: boolean) => void;
  onSave: () => void;
};

/** Presentational: every value comes in as a prop, so it renders the same under react-dom/server as in the browser. */
export function EmailPreferencesCard({
  value,
  emailPaused,
  emailDelivery,
  dirty,
  saving = false,
  error = null,
  onToggle,
  onTogglePause,
  onSave,
}: EmailPreferencesCardProps) {
  return (
    <SettingsCard id="email" title={CARD_TITLE} description={CARD_DESCRIPTION}>
      {!emailDelivery ? (
        <Callout tone="info" className="mb-3">
          Vybe isn’t sending activity e-mail yet. Your choices are kept for when it does.
        </Callout>
      ) : null}
      <ToggleRow
        title={EMAIL_PAUSE_LABEL.title}
        hint={EMAIL_PAUSE_LABEL.hint}
        checked={emailPaused}
        disabled={saving}
        onChange={onTogglePause}
      />
      {emailPaused ? (
        <Callout tone="warning" className="my-2">
          All e-mail is paused. Turn “Pause all e-mail” off to adjust the individual kinds.
        </Callout>
      ) : null}
      <div className="mt-1 divide-y divide-line border-t border-line">
        {EMAIL_SETTING_KEYS.map((key) => (
          <ToggleRow
            key={key}
            title={EMAIL_LABELS[key].title}
            hint={EMAIL_LABELS[key].hint}
            checked={value[key]}
            disabled={saving || emailPaused}
            onChange={(next) => onToggle(key, next)}
          />
        ))}
      </div>
      {error ? (
        <p id="email-preferences-error" role="alert" className="mt-3 text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-text-3" aria-live="polite">
          {dirty ? 'You have unsaved changes.' : 'Up to date.'}
        </p>
        <Button variant="primary" loading={saving} disabled={!dirty} onClick={onSave}>
          Save email preferences
        </Button>
      </div>
    </SettingsCard>
  );
}

/** Only the keys the member touched; `emailPaused` rides beside them when it moved. */
type Draft = Partial<EmailSettings> & { emailPaused?: boolean };
type SavePayload = { patch: Partial<EmailSettings>; emailPaused?: boolean };

export function EmailPreferencesSection() {
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState<string | null>(null);

  const prefsQuery = useQuery({
    queryKey: EMAIL_SETTINGS_KEY,
    queryFn: async () => {
      const { data } = await api.get('/users/email-preferences');
      return pickEmailPreferences(data);
    },
  });

  const base = prefsQuery.data ?? DEFAULT_EMAIL_PREFERENCES;
  const { emailPaused: draftPaused, ...draftSettings } = draft;
  const value: EmailSettings = { ...base.settings, ...draftSettings };
  const emailPaused = draftPaused ?? base.emailPaused;
  const patch = Object.fromEntries(
    EMAIL_SETTING_KEYS.filter((k) => value[k] !== base.settings[k]).map((k) => [k, value[k]]),
  ) as Partial<EmailSettings>;
  const pauseChanged = emailPaused !== base.emailPaused;
  const changed: SavePayload = pauseChanged ? { patch, emailPaused } : { patch };
  const dirty = Object.keys(patch).length > 0 || pauseChanged;

  const save = useMutation({
    mutationFn: async ({ patch, emailPaused }: SavePayload) => {
      // The three bodies the API accepts (services/emailPreferences.js): the
      // switches alone, the switches with the pause, or the pause alone.
      const { data } =
        Object.keys(patch).length === 0
          ? await api.put('/users/email-preferences', { emailPaused })
          : emailPaused === undefined
            ? await api.put('/users/email-preferences', { notifications: patch })
            : await api.put('/users/email-preferences', { notifications: patch, emailPaused });
      return pickEmailPreferences(data);
    },
    onSuccess: (settings) => {
      qc.setQueryData(EMAIL_SETTINGS_KEY, settings);
      setDraft({});
      setError(null);
      toast.success('Email preferences saved');
    },
    onError: (e) => {
      const parsed = parseApiError(e, 'Could not save your email preferences.');
      // A 400 names the key it refused; that belongs under the rows, with the draft kept.
      if (parsed.status === 400 && parsed.field) {
        setError(parsed.message);
        return;
      }
      toast.error(parsed.message);
    },
  });

  if (prefsQuery.isLoading) {
    return (
      <SettingsCard id="email" title={CARD_TITLE}>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-sm" />
          ))}
        </div>
      </SettingsCard>
    );
  }

  if (prefsQuery.isError) {
    return (
      <SettingsCard id="email" title={CARD_TITLE}>
        <ErrorState title="Preferences unavailable" error={prefsQuery.error} retry={() => void prefsQuery.refetch()} />
      </SettingsCard>
    );
  }

  return (
    <EmailPreferencesCard
      value={value}
      emailPaused={emailPaused}
      emailDelivery={base.emailDelivery}
      dirty={dirty}
      saving={save.isPending}
      error={error}
      onToggle={(key, next) => {
        setError(null);
        setDraft((d) => ({ ...d, [key]: next }));
      }}
      onTogglePause={(next) => {
        setError(null);
        setDraft((d) => ({ ...d, emailPaused: next }));
      }}
      onSave={() => save.mutate(changed)}
    />
  );
}

export default EmailPreferencesSection;
