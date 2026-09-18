import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { format } from 'date-fns';
import { mediaUrl } from '../../lib/api';
import { Badge, Button, ButtonLink, Callout, Chip, Input, cx, humanize, useToast } from '../../components/ui';
import { Dumbbell, Hash, Image as ImageIcon, Layers, Upload, X } from '../../components/icons';
import {
  CATALOG_IMAGE_MAX_BYTES,
  catalogImageContentType,
  uploadCatalogImage,
  type CatalogCategory,
  type CatalogImage,
  type CatalogLevel,
} from './catalogApi';
import { LIMITS, addHashtags, type CatalogErrorDetails, type ImageDraft } from './catalogRules';

/* ------------------------------------------------------------------ *
 * Form pieces shared by the workout and plan editors.
 * ------------------------------------------------------------------ */

export const CATEGORY_TONE: Record<CatalogCategory, 'brand' | 'info' | 'accent' | 'neutral' | 'success' | 'warning'> = {
  strength: 'brand',
  cardio: 'accent',
  hiit: 'accent',
  running: 'info',
  yoga: 'success',
  flexibility: 'success',
  sports: 'info',
  other: 'neutral',
};

export function CategoryBadge({ category }: { category: CatalogCategory | string }) {
  const tone = CATEGORY_TONE[category as CatalogCategory] ?? 'neutral';
  return <Badge tone={tone}>{humanize(category)}</Badge>;
}

export function LevelBadge({ level }: { level: CatalogLevel | string | null | undefined }) {
  if (!level) return null;
  return <Badge tone="neutral">{humanize(level)}</Badge>;
}

export const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? format(d, 'MMM d, yyyy') : '—';
};

export const fmtDateTime = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? format(d, 'MMM d, yyyy HH:mm') : '—';
};

export const fmtMinutes = (minutes: number | null | undefined) => (minutes ? `${minutes} min` : '—');
export const fmtKcal = (kcal: number | null | undefined) => (kcal === null || kcal === undefined ? '—' : `${kcal.toLocaleString()} kcal`);

/** 40 px cover thumbnail with a kind-specific fallback glyph. */
export function CatalogThumb({ image, kind, size = 40 }: { image: CatalogImage | null | undefined; kind: 'workout' | 'plan'; size?: 40 | 48 | 56 }) {
  const [broken, setBroken] = useState(false);
  const px = size === 56 ? 'h-14 w-14' : size === 48 ? 'h-12 w-12' : 'h-10 w-10';
  const src = image?.uri;
  if (!src || broken) {
    return (
      <div className={cx('flex shrink-0 items-center justify-center rounded-sm border border-line bg-surface-2 text-text-3', px)} aria-hidden="true">
        {kind === 'plan' ? <Layers size={18} /> : <Dumbbell size={18} />}
      </div>
    );
  }
  return (
    <div className={cx('shrink-0 overflow-hidden rounded-sm border border-line bg-surface-2', px)}>
      <img src={mediaUrl(src)} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
    </div>
  );
}

/* -------------------------------------------------------------- numbers */

/** Whole-number text field: numeric keypad on phones, no spinner surprises, bounds shown as a hint. */
export function WholeNumberInput({
  label,
  hint,
  error,
  value,
  onChange,
  min,
  max,
  unit,
  containerClassName,
  disabled,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> & {
  label: string;
  hint?: string;
  error?: string | null;
  value: string;
  onChange: (next: string) => void;
  min: number;
  max: number;
  unit?: string;
  containerClassName?: string;
}) {
  return (
    <Input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      label={label}
      hint={hint ?? `${min}–${max}${unit ? ` ${unit}` : ''}`}
      error={error}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      containerClassName={containerClassName}
      className="tabular"
      {...rest}
    />
  );
}

/* ------------------------------------------------------------- hashtags */

export function HashtagsField({
  tags,
  onChange,
  error,
  disabled,
}: {
  tags: string[];
  onChange: (next: string[]) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const full = tags.length >= LIMITS.hashtags.max;

  const commit = (raw: string) => {
    if (!raw.trim()) return;
    const result = addHashtags(tags, raw);
    if (result.tags.length !== tags.length) onChange(result.tags);
    if (result.rejected.length) {
      setProblem(
        `Skipped ${result.rejected.map((t) => `“${t}”`).join(', ')}: tags use letters, numbers and underscores only (1–${LIMITS.hashtag.max} characters).`,
      );
    } else if (result.full) {
      setProblem(`A workout can carry at most ${LIMITS.hashtags.max} hashtags.`);
    } else {
      setProblem(null);
    }
    setDraft('');
  };

  return (
    <div>
      <Input
        id={id}
        label="Hashtags"
        leading={<Hash size={18} />}
        value={draft}
        disabled={disabled || full}
        placeholder={full ? 'Limit reached' : 'Add a tag and press Enter'}
        autoComplete="off"
        maxLength={LIMITS.hashtag.max + 1}
        hint={`Press Enter or comma to add. ${tags.length}/${LIMITS.hashtags.max}.`}
        error={error ?? problem}
        onChange={(e) => {
          const value = e.target.value;
          if (/[,\s]/.test(value)) commit(value);
          else setDraft(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
          } else if (e.key === 'Backspace' && !draft && tags.length && !disabled) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text');
          if (/[,\s]/.test(pasted)) {
            e.preventDefault();
            commit(`${draft} ${pasted}`);
          }
        }}
      />
      {tags.length ? (
        <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Hashtags added">
          {tags.map((tag) => (
            <li key={tag}>
              <Chip
                removeLabel={`Remove hashtag ${tag}`}
                onRemove={disabled ? undefined : () => onChange(tags.filter((t) => t !== tag))}
              >
                #{tag}
              </Chip>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ cover image */

export function CoverImageField({
  value,
  onChange,
  error,
  disabled,
  label = 'Cover image',
}: {
  value: ImageDraft;
  onChange: (next: ImageDraft) => void;
  error?: string | null;
  disabled?: boolean;
  label?: string;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const previewRef = useRef<string | null>(null);
  const labelId = useId();

  // Object URLs for local previews are released when replaced or on unmount.
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const preview = value.state === 'current' ? mediaUrl(value.uri) : value.state === 'uploaded' ? value.previewUrl : null;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setLocalError(null);
    const contentType = catalogImageContentType(file);
    if (!contentType) {
      setLocalError('Use a JPEG, PNG, WEBP or HEIC image.');
      return;
    }
    if (file.size > CATALOG_IMAGE_MAX_BYTES) {
      setLocalError(`Images must be ${Math.round(CATALOG_IMAGE_MAX_BYTES / 1024 / 1024)} MB or smaller.`);
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadCatalogImage(file, contentType);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      const previewUrl = URL.createObjectURL(file);
      previewRef.current = previewUrl;
      setBroken(false);
      onChange({ state: 'uploaded', key: uploaded.key, previewUrl });
    } catch (e) {
      toast.error(e, 'Upload failed.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div>
      <span id={labelId} className="type-label mb-1.5 block text-text-2">{label}</span>
      <div
        className={cx(
          'relative overflow-hidden rounded-md border bg-surface-2',
          preview && !broken ? 'border-line' : 'border-dashed border-line-strong',
        )}
        style={{ aspectRatio: '16 / 9' }}
      >
        {preview && !broken ? (
          <img src={preview} alt="Cover preview" onError={() => setBroken(true)} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-text-3">
            <ImageIcon size={26} />
            <span className="text-xs">{preview && broken ? 'Preview unavailable for this format' : 'No cover image'}</span>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={<Upload size={16} />}
          loading={uploading}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          aria-describedby={error || localError ? undefined : `${labelId}-hint`}
        >
          {preview ? 'Replace image' : 'Upload image'}
        </Button>
        {preview ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<X size={16} />}
            disabled={disabled || uploading}
            onClick={() => {
              setBroken(false);
              onChange({ state: 'none' });
            }}
          >
            Remove
          </Button>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp,.heic"
          className="sr-only"
          tabIndex={-1}
          aria-labelledby={labelId}
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>
      {error || localError ? (
        <p role="alert" className="mt-1.5 text-xs text-danger">{error ?? localError}</p>
      ) : (
        <p id={`${labelId}-hint`} className="mt-1.5 text-xs text-text-3">
          JPEG, PNG, WEBP or HEIC up to {Math.round(CATALOG_IMAGE_MAX_BYTES / 1024 / 1024)} MB. Shown 16:9 in the app.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- editor UX */

/** Warns before the tab closes with unsaved edits. Route changes inside the SPA are handled by the Cancel button's confirm. */
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome still requires returnValue to be set for the prompt to show.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}

/** The save failure banner: stale records get a reload action, everything else the API's message. */
export function SaveErrorCallout({
  details,
  onReload,
  backTo,
}: {
  details: CatalogErrorDetails | null;
  onReload?: () => void;
  backTo: string;
}) {
  if (!details) return null;
  if (details.status === 404) {
    return (
      <Callout
        tone="danger"
        title="This item no longer exists"
        action={
          <ButtonLink to={backTo} size="sm" variant="secondary">
            Back to catalog
          </ButtonLink>
        }
      >
        Another administrator deleted it while you were editing.
      </Callout>
    );
  }
  if (details.stale && onReload) {
    return (
      <Callout
        tone="warning"
        title="This item changed while you were editing"
        action={
          <Button size="sm" variant="secondary" onClick={onReload}>
            Reload
          </Button>
        }
      >
        Reloading replaces your unsaved edits with the latest saved version.
      </Callout>
    );
  }
  if (details.status === 403) {
    return (
      <Callout tone="danger" title="Not allowed">
        {details.message}
      </Callout>
    );
  }
  const fieldCount = Object.keys(details.fields).length + Object.keys(details.rows).length;
  return (
    <Callout tone="danger" title={details.offline ? 'You’re offline' : 'Could not save'}>
      {details.message}
      {fieldCount ? ' The highlighted fields explain what to fix.' : ''}
    </Callout>
  );
}

/** Key/value facts for the editor sidebar (ids in mono, like the rest of the console). */
export function FactList({ facts }: { facts: Array<{ label: string; value: ReactNode; mono?: boolean }> }) {
  return (
    <dl className="grid gap-2">
      {facts.map((fact) => (
        <div key={fact.label} className="admin-kv">
          <dt>{fact.label}</dt>
          <dd className={cx(fact.mono && 'admin-code')}>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
