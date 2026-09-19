import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { mergeAccount, useAuth, type User } from '../lib/auth';
import { applyAccessibility } from '../lib/accessibility';
import { HIDDEN_WORDS_MAX_CUSTOM, HIDDEN_WORDS_MAX_LENGTH, formatHiddenWords, parseHiddenWords, sameHiddenWords } from '../lib/hiddenWords';
import { COMMENT_POLICIES, type AccessibilitySettings, type CommentPolicy, type PublicUser, type SettingsPatch } from '../lib/hooks';
import { Button, Card, Select, Switch, Textarea, cx, useToast, type SelectOption } from './ui';

/**
 * The account-preference cards Settings mounts once as <AccountPreferenceSections />:
 *
 *   Comments and hidden words  settings.commentDefault { policy, approveFirst } and
 *                              hiddenWords { enabled, useDefaultList, applyToMessageRequests, custom }
 *   Accessibility              settings.accessibility { reduceMotion, largeText }, applied to <html>
 *                              at once (lib/accessibility) and rolled back if the save fails
 *
 * Every write is one `PUT /users/settings` PATCH with only allow-listed keys
 * (lib/accountTypes SETTINGS_KEYS), an optimistic update on the ['me'] query
 * with rollback, and `setUser(mergeAccount(...))` on success so hasPassword
 * survives (the PUT answers without it). Server errors are
 * `400 { message, field }`; the hidden-words message lands under the field.
 *
 * The card and row markup mirrors Settings.tsx's SettingsCard / ToggleRow so
 * the page reads as one; they stay private to that file to keep it a
 * single-mount-point change.
 */

/* ------------------------------------------------------------------ pieces */

function PrefCard({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card id={id} role="region" aria-labelledby={`${id}-title`} className="scroll-mt-20">
      <h2 id={`${id}-title`} className="type-heading text-lg text-text-1">
        {title}
      </h2>
      {description ? <p className="mt-1 text-sm text-text-2">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

function PrefToggleRow({ title, hint, checked, disabled, onChange }: { title: string; hint: string; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className={cx('flex min-h-11 items-center gap-4 py-2', disabled && 'opacity-70')}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-1">{title}</p>
        <p className="text-xs text-text-2">{hint}</p>
      </div>
      <Switch checked={checked} disabled={disabled} label={title} onChange={onChange} />
    </div>
  );
}

/* ------------------------------------------------------------------ data */

/** The same ['me'] query the Account and Privacy cards share, seeded from the session. */
function useAccount() {
  const authUser = useAuth((s) => s.user);
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data } = await api.get('/users/me');
      return (data.user || data) as PublicUser;
    },
    initialData: (authUser as PublicUser) ?? undefined,
  });
}

type SaveVars = {
  /** Only SETTINGS_KEYS at the top level; the API rejects anything else with 400. */
  patch: SettingsPatch;
  /** Optimistic shape of the account while the request runs. */
  optimistic?: (old: PublicUser) => PublicUser;
  /** Undo any side effect applied optimistically (attributes on <html>). */
  rollback?: () => void;
};

/** Server message for a per-key 400 ({ message, field }); null for anything else. */
const settingsFieldError = (e: unknown, field: string): string | null => {
  const data = (e as { response?: { status?: number; data?: { message?: string; field?: string } } })?.response?.data;
  return data?.field === field && typeof data.message === 'string' ? data.message : null;
};

function useSettingsSave({ fallback, onError }: { fallback: string; onError?: (e: unknown) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const setUser = useAuth((s) => s.setUser);
  return useMutation({
    mutationFn: async ({ patch }: SaveVars) => {
      const { data } = await api.put('/users/settings', patch);
      return (data.user || data) as PublicUser;
    },
    onMutate: async ({ optimistic }) => {
      await qc.cancelQueries({ queryKey: ['me'] });
      const previous = qc.getQueryData<PublicUser>(['me']);
      if (optimistic) qc.setQueryData<PublicUser>(['me'], (old) => (old ? optimistic(old) : old));
      return { previous };
    },
    onSuccess: (user) => {
      qc.setQueryData(['me'], user);
      setUser(mergeAccount(useAuth.getState().user, user as User));
    },
    onError: (e, vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(['me'], ctx.previous);
      vars.rollback?.();
      if (onError) onError(e);
      else toast.error(e, fallback);
    },
  });
}

/* ------------------------------------------------------------------ hidden words editor */

/**
 * Pure editor: `value` is the saved list (from the account), `onSave` gets the
 * parsed list. Re-hydrates whenever `value` changes, which is how the server's
 * own de-duplication (it also folds leetspeak) shows up after a save.
 */
export function HiddenWordsEditor({
  value,
  onSave,
  saving = false,
  disabled = false,
  serverError = null,
}: {
  value: readonly string[];
  onSave: (words: string[]) => void;
  saving?: boolean;
  disabled?: boolean;
  /** `400 { message, field: 'hiddenWords' }` from the last save, shown under the field until the text changes. */
  serverError?: string | null;
}) {
  const savedKey = value.join('\n');
  const [text, setText] = useState(() => formatHiddenWords(value));
  const [seenKey, setSeenKey] = useState(savedKey);
  const [submittedText, setSubmittedText] = useState<string | null>(null);
  if (seenKey !== savedKey) {
    // The saved list changed underneath us (save answered, or a refresh): show it.
    setSeenKey(savedKey);
    setText(formatHiddenWords(value));
  }

  const parsed = useMemo(() => parseHiddenWords(text), [text]);
  const changed = !sameHiddenWords(parsed.words, value);
  const error = parsed.errors[0] ?? (serverError && submittedText === text ? serverError : null);
  const canSave = changed && parsed.errors.length === 0 && !saving && !disabled;

  return (
    <form
      className="mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave) return;
        setSubmittedText(text);
        onSave(parsed.words);
      }}
    >
      <Textarea
        id="hidden-words"
        label="Your hidden words"
        hint={`One per line or separated by commas. Up to ${HIDDEN_WORDS_MAX_CUSTOM} words, ${HIDDEN_WORDS_MAX_LENGTH} characters each.`}
        error={error}
        rows={3}
        autoGrow
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="tabular text-xs text-text-3" aria-live="polite">{`${parsed.words.length} of ${HIDDEN_WORDS_MAX_CUSTOM}`}</p>
        <Button type="submit" variant="secondary" size="sm" disabled={!canSave} loading={saving}>
          Save hidden words
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ comments and hidden words */

const POLICY_LABELS: Record<CommentPolicy, string> = {
  everyone: 'Everyone',
  followers: 'People who follow you',
  following: 'People you follow',
  off: 'No one',
};
const POLICY_OPTIONS: SelectOption[] = COMMENT_POLICIES.map((value) => ({ value, label: POLICY_LABELS[value] }));

const isPolicy = (value: unknown): value is CommentPolicy => (COMMENT_POLICIES as readonly string[]).includes(String(value));

function CommentsSection() {
  const me = useAccount();
  const account = me.data;
  const policy: CommentPolicy = isPolicy(account?.settings?.commentDefault?.policy) ? (account!.settings!.commentDefault!.policy as CommentPolicy) : 'everyone';
  const approveFirst = account?.settings?.commentDefault?.approveFirst === true;
  const hidden = account?.hiddenWords;
  const hiddenEnabled = hidden?.enabled !== false;
  const useDefaultList = hidden?.useDefaultList !== false;
  const applyToRequests = hidden?.applyToMessageRequests !== false;
  const custom = hidden?.custom ?? [];

  const toast = useToast();
  const save = useSettingsSave({ fallback: 'Could not save this setting.' });
  const [wordsError, setWordsError] = useState<string | null>(null);
  const saveWords = useSettingsSave({
    fallback: 'Could not save your hidden words.',
    onError: (e) => {
      const message = settingsFieldError(e, 'hiddenWords');
      if (message) setWordsError(message);
      else toast.error(e, 'Could not save your hidden words.');
    },
  });

  const patchCommentDefault = (next: { policy?: CommentPolicy; approveFirst?: boolean }) =>
    save.mutate({
      patch: { commentDefault: next },
      optimistic: (old) => ({ ...old, settings: { ...(old.settings ?? {}), commentDefault: { ...(old.settings?.commentDefault ?? {}), ...next } } }),
    });
  const patchHiddenWords = (next: Partial<NonNullable<PublicUser['hiddenWords']>>) =>
    save.mutate({
      patch: { hiddenWords: next },
      optimistic: (old) => ({ ...old, hiddenWords: { enabled: true, useDefaultList: true, applyToMessageRequests: true, custom: [], ...(old.hiddenWords ?? {}), ...next } }),
    });

  const busy = save.isPending || !account;

  return (
    <PrefCard
      id="comments"
      title="Comments and hidden words"
      description="Who can comment on your new posts, and the words that keep comments and message requests out of sight."
    >
      <Select
        id="comment-default-policy"
        label="Who can comment by default"
        hint="Applies to new posts. You can change it per post."
        options={POLICY_OPTIONS}
        value={policy}
        disabled={busy}
        onChange={(value) => {
          if (isPolicy(value) && value !== policy) patchCommentDefault({ policy: value });
        }}
      />
      <PrefToggleRow
        title="Approve comments first"
        hint="New comments wait for you before anyone else sees them."
        checked={approveFirst}
        disabled={busy}
        onChange={(approveFirst) => patchCommentDefault({ approveFirst })}
      />
      <div className="mt-2 border-t border-line pt-4">
        <h3 className="text-sm font-semibold text-text-1">Hidden words</h3>
        <p className="text-xs text-text-2">Comments and message requests that match are hidden from you. Nobody is told.</p>
        <PrefToggleRow
          title="Hide comments with hidden words"
          hint="Turn the filter on or off without losing your list."
          checked={hiddenEnabled}
          disabled={busy}
          onChange={(enabled) => patchHiddenWords({ enabled })}
        />
        <PrefToggleRow
          title="Use Vybe’s default list"
          hint="Common insults and slurs, kept up to date by Vybe."
          checked={useDefaultList}
          disabled={busy || !hiddenEnabled}
          onChange={(useDefaultList) => patchHiddenWords({ useDefaultList })}
        />
        <PrefToggleRow
          title="Also filter message requests"
          hint="Messages from people you are not connected with are checked too."
          checked={applyToRequests}
          disabled={busy || !hiddenEnabled}
          onChange={(applyToMessageRequests) => patchHiddenWords({ applyToMessageRequests })}
        />
        <HiddenWordsEditor
          value={custom}
          saving={saveWords.isPending}
          disabled={!account}
          serverError={wordsError}
          onSave={(words) => {
            setWordsError(null);
            saveWords.mutate(
              { patch: { hiddenWords: { custom: words } } },
              { onSuccess: () => toast.success('Hidden words saved') },
            );
          }}
        />
      </div>
    </PrefCard>
  );
}

/* ------------------------------------------------------------------ accessibility */

function AccessibilitySection() {
  const me = useAccount();
  const account = me.data;
  const flags: AccessibilitySettings = account?.settings?.accessibility ?? {};
  const reduceMotion = flags.reduceMotion === true;
  const largeText = flags.largeText === true;
  const save = useSettingsSave({ fallback: 'Could not save this setting.' });

  const withFlags = (old: PublicUser, next: AccessibilitySettings): PublicUser => ({
    ...old,
    settings: { ...(old.settings ?? {}), accessibility: { ...(old.settings?.accessibility ?? {}), ...next } },
  });
  // Applied at once so the change is felt before the request returns; undone if it fails.
  const apply = (next: AccessibilitySettings) => {
    const before = { ...flags };
    applyAccessibility({ ...flags, ...next });
    return () => applyAccessibility(before);
  };

  const busy = save.isPending || !account;

  return (
    <PrefCard id="accessibility" title="Accessibility" description="These follow you to every device you sign in on. Your device’s own settings still apply.">
      <PrefToggleRow
        title="Reduce motion"
        hint="Fewer animations and transitions across Vybe."
        checked={reduceMotion}
        disabled={busy}
        onChange={(reduceMotion) =>
          save.mutate({ patch: { accessibility: { reduceMotion } }, optimistic: (old) => withFlags(old, { reduceMotion }), rollback: apply({ reduceMotion }) })
        }
      />
      <PrefToggleRow
        title="Larger text"
        hint="Slightly larger type everywhere."
        checked={largeText}
        disabled={busy}
        onChange={(largeText) =>
          save.mutate({ patch: { accessibility: { largeText } }, optimistic: (old) => withFlags(old, { largeText }), rollback: apply({ largeText }) })
        }
      />
    </PrefCard>
  );
}

/* ------------------------------------------------------------------ mount */

/** Mounted once in Settings, after the Privacy card. */
export default function AccountPreferenceSections() {
  return (
    <>
      <CommentsSection />
      <AccessibilitySection />
    </>
  );
}
