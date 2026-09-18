import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { differenceInCalendarDays, format, isValid, parseISO } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_BYTES, uploadImage } from '../lib/hooks';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  Spinner,
  StatGrid,
  StatTile,
  Tabs,
  Textarea,
  cx,
  formatStat,
  humanize,
  useIsCompact,
  useToast,
} from './ui';
import { Camera, Calendar, Edit, Image as ImageIcon, Plus, Trash, TrendingDown, TrendingUp, Upload } from './icons';

/* ------------------------------------------------------------------ types */

export type PhotoType = 'front' | 'side' | 'back' | 'other';

export type Measurements = {
  chest?: number | null;
  waist?: number | null;
  hips?: number | null;
  arms?: number | null;
  thighs?: number | null;
};

export type ProgressPhoto = {
  _id: string;
  user: string;
  photo_url: string;
  weight?: number | null;
  notes?: string;
  photo_type?: PhotoType;
  date: string;
  measurements?: Measurements | null;
  createdAt?: string;
  updatedAt?: string;
};

type ComparisonResponse = {
  message?: string;
  first: ProgressPhoto | null;
  latest: ProgressPhoto | null;
  weightChange?: string | null;
  daysBetween?: number;
  /** `null` for a measurement missing on either check-in: unknown, not "no change". */
  measurementChanges?: Record<keyof Measurements, number | null> | null;
};

const PHOTO_TYPES: PhotoType[] = ['front', 'side', 'back', 'other'];
const MEASUREMENT_KEYS: (keyof Measurements)[] = ['chest', 'waist', 'hips', 'arms', 'thighs'];

const PHOTOS_KEY = ['progress-photos'];

const ANGLE_OPTIONS = PHOTO_TYPES.map((t) => ({ value: t, label: humanize(t) }));
const FILTER_OPTIONS = [{ value: '', label: 'All angles' }, ...ANGLE_OPTIONS];

/* -------------------------------------------------------------- utilities */

const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'd MMM yyyy') : '—';
};

const numberOrUndefined = (raw: string): number | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

const signed = (n: number, digits = 1) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;

type MetaForm = {
  weight: string;
  notes: string;
  photo_type: PhotoType;
  measurements: Record<keyof Measurements, string>;
};

const emptyMeta = (): MetaForm => ({
  weight: '',
  notes: '',
  photo_type: 'front',
  measurements: { chest: '', waist: '', hips: '', arms: '', thighs: '' },
});

const metaFromPhoto = (photo: ProgressPhoto): MetaForm => ({
  weight: photo.weight == null ? '' : String(photo.weight),
  notes: photo.notes ?? '',
  photo_type: photo.photo_type ?? 'front',
  measurements: MEASUREMENT_KEYS.reduce(
    (acc, key) => {
      const value = photo.measurements?.[key];
      acc[key] = value == null ? '' : String(value);
      return acc;
    },
    {} as Record<keyof Measurements, string>,
  ),
});

function serializeMeta(form: MetaForm) {
  const measurements = MEASUREMENT_KEYS.reduce<Record<string, number>>((acc, key) => {
    const value = numberOrUndefined(form.measurements[key]);
    if (value !== undefined) acc[key] = value;
    return acc;
  }, {});
  return {
    weight: numberOrUndefined(form.weight),
    notes: form.notes.trim() || undefined,
    photo_type: form.photo_type,
    measurements: Object.keys(measurements).length ? measurements : undefined,
  };
}

/* ------------------------------------------------------- metadata form UI */

function MetaFields({ form, onChange, disabled }: { form: MetaForm; onChange: (next: MetaForm) => void; disabled?: boolean }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Weight"
          type="number"
          min={0}
          step="0.1"
          inputMode="decimal"
          placeholder="Optional"
          trailing={<span className="text-xs font-semibold">kg</span>}
          value={form.weight}
          disabled={disabled}
          onChange={(e) => onChange({ ...form, weight: e.target.value })}
        />
        <Select label="Angle" name="photo_type" options={ANGLE_OPTIONS} value={form.photo_type} disabled={disabled} onChange={(v) => onChange({ ...form, photo_type: v as PhotoType })} />
      </div>

      <fieldset className="min-w-0">
        <legend className="type-label mb-1.5 text-text-2">Measurements in cm, optional</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {MEASUREMENT_KEYS.map((key) => (
            <Input
              key={key}
              label={humanize(key)}
              type="number"
              min={0}
              step="0.1"
              inputMode="decimal"
              placeholder="—"
              value={form.measurements[key]}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...form,
                  measurements: { ...form.measurements, [key]: e.target.value },
                })
              }
            />
          ))}
        </div>
      </fieldset>

      <Textarea
        label="Notes"
        rows={3}
        maxLength={1000}
        placeholder="How you feel, what changed, anything worth remembering about this check-in"
        value={form.notes}
        disabled={disabled}
        onChange={(e) => onChange({ ...form, notes: e.target.value })}
      />
    </div>
  );
}

/* ------------------------------------------------------------ upload modal */

function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState<MetaForm>(emptyMeta);
  const [preview, setPreview] = useState<string>('');
  const [storageKey, setStorageKey] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (open) return;
    setForm(emptyMeta());
    setStorageKey('');
    setFileError(null);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
    if (fileRef.current) fileRef.current.value = '';
  }, [open]);

  async function handleFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setFileError('Use a JPEG, PNG, WebP or HEIC image.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setFileError('That image is larger than 10 MB. Pick a smaller one.');
      return;
    }
    setFileError(null);
    setUploading(true);
    try {
      const uploaded = await uploadImage(file, 'posts');
      setStorageKey(uploaded.key);
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
    } catch (e) {
      setFileError(errMsg(e, 'Upload failed. Check your connection and try again.'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!storageKey) throw new Error('Choose a photo first');
      const { data } = await api.post<ProgressPhoto>('/progress-photos', {
        photo_url: storageKey,
        ...serializeMeta(form),
      });
      return data;
    },
    onSuccess: () => {
      toast.success('Check-in saved');
      qc.invalidateQueries({ queryKey: PHOTOS_KEY });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not save this check-in')),
  });

  const formId = 'progress-photo-upload';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New check-in"
      description="Same spot, same light, same time of day gives the cleanest comparison."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={save.isPending} disabled={!storageKey || uploading}>
            Save check-in
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <input ref={fileRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} className="sr-only" tabIndex={-1} onChange={(e) => void handleFile(e.target.files)} />
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            aria-label={storageKey ? 'Replace photo' : 'Choose a photo'}
            aria-describedby={`${formId}-filehint`}
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void handleFile(e.dataTransfer.files);
            }}
            className={cx(
              'relative flex aspect-[3/4] w-full shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed bg-surface-2 text-text-3 transition-colors dur-1 sm:w-44',
              dragging ? 'border-brand bg-brand-soft' : 'border-line-strong hover:border-control hover:text-text-2',
              fileError && 'border-danger',
            )}
          >
            {preview ? (
              <img src={preview} alt="Selected progress photo" className="h-full w-full object-cover" />
            ) : uploading ? (
              <Spinner size={24} />
            ) : (
              <span className="flex flex-col items-center gap-2 px-3 text-center">
                <ImageIcon size={28} />
                <span className="text-xs font-semibold text-text-2">Tap to choose</span>
              </span>
            )}
          </button>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-3">
            <Button variant="secondary" loading={uploading} icon={<Upload size={18} />} onClick={() => fileRef.current?.click()} className="w-full sm:w-auto">
              {storageKey ? 'Replace photo' : 'Choose photo'}
            </Button>
            {fileError ? (
              <p role="alert" className="text-xs text-danger">
                {fileError}
              </p>
            ) : (
              <p id={`${formId}-filehint`} className="text-xs text-text-3">
                JPEG, PNG, WebP or HEIC, up to 10 MB. Check-ins never appear in your feed or profile.
              </p>
            )}
          </div>
        </div>

        <MetaFields form={form} onChange={setForm} disabled={save.isPending} />
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------- edit modal */

function EditModal({ photoId, onClose }: { photoId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<MetaForm>(emptyMeta);

  const detail = useQuery({
    queryKey: ['progress-photos', 'detail', photoId],
    queryFn: async (): Promise<ProgressPhoto> => {
      const { data } = await api.get<ProgressPhoto>(`/progress-photos/${photoId}`);
      return data;
    },
    enabled: !!photoId,
  });

  useEffect(() => {
    if (detail.data) setForm(metaFromPhoto(detail.data));
  }, [detail.data]);

  const update = useMutation({
    mutationFn: async () => {
      const { data } = await api.put<ProgressPhoto>(`/progress-photos/${photoId}`, serializeMeta(form));
      return data;
    },
    onSuccess: () => {
      toast.success('Check-in updated');
      qc.invalidateQueries({ queryKey: PHOTOS_KEY });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not update this check-in')),
  });

  const formId = 'progress-photo-edit';

  return (
    <Modal
      open={!!photoId}
      onClose={onClose}
      title="Edit check-in"
      size="md"
      footer={
        detail.data ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="primary" loading={update.isPending}>
              Save changes
            </Button>
          </>
        ) : undefined
      }
    >
      {detail.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-44 w-full rounded-md" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : detail.isError ? (
        <ErrorState error={detail.error} title="Could not load this check-in" retry={() => detail.refetch()} />
      ) : detail.data ? (
        <form
          id={formId}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate();
          }}
        >
          <div className="flex flex-col gap-3 sm:flex-row">
            <img
              src={mediaUrl(detail.data.photo_url)}
              alt={`Progress photo from ${fmtDate(detail.data.date)}`}
              className="aspect-[3/4] w-full rounded-md bg-surface-2 object-cover sm:w-44"
              loading="lazy"
            />
            <div className="flex flex-col justify-center gap-2 text-sm">
              <p className="inline-flex items-center gap-1.5 text-text-2">
                <Calendar size={14} /> {fmtDate(detail.data.date)}
              </p>
              <Badge tone="brand" className="w-fit">
                {humanize(detail.data.photo_type ?? 'front')}
              </Badge>
              <p className="text-xs text-text-3">The photo itself can’t be swapped; delete the check-in and add a new one instead.</p>
            </div>
          </div>

          <MetaFields form={form} onChange={setForm} disabled={update.isPending} />
        </form>
      ) : null}
    </Modal>
  );
}

/* -------------------------------------------------------- comparison view */

function ComparisonSlider({ before, after }: { before: ProgressPhoto; after: ProgressPhoto }) {
  const [position, setPosition] = useState(50);

  return (
    <div className="space-y-3">
      <div className="relative aspect-[3/4] w-full select-none overflow-hidden rounded-md bg-surface-3">
        <img src={mediaUrl(after.photo_url)} alt={`Latest progress photo from ${fmtDate(after.date)}`} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
        <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
          <img src={mediaUrl(before.photo_url)} alt={`First progress photo from ${fmtDate(before.date)}`} className="h-full w-full object-cover" draggable={false} />
        </div>
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-surface-1 shadow-2" style={{ left: `${position}%` }} />
        <Badge tone="neutral" className="pointer-events-none absolute top-2 left-2 bg-surface-1 shadow-2">
          Before, {fmtDate(before.date)}
        </Badge>
        <Badge tone="neutral" className="pointer-events-none absolute top-2 right-2 bg-surface-1 shadow-2">
          After, {fmtDate(after.date)}
        </Badge>
      </div>
      <label className="block">
        <span className="sr-only">Reveal the before photo</span>
        <input type="range" min={0} max={100} value={position} className="h-11 w-full cursor-ew-resize" onChange={(e) => setPosition(Number(e.target.value))} />
      </label>
    </div>
  );
}

function ComparisonPanel() {
  const [photoType, setPhotoType] = useState<'' | PhotoType>('');

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['progress-photos', 'comparison', photoType],
    queryFn: async (): Promise<ComparisonResponse> => {
      const { data } = await api.get<ComparisonResponse>('/progress-photos/comparison', {
        params: photoType ? { photo_type: photoType } : undefined,
      });
      return data;
    },
  });

  const changes = data?.measurementChanges ?? null;
  const weightChange = data?.weightChange == null ? null : Number(data.weightChange);
  const hasPair = Boolean(data?.first && data?.latest && data.first._id !== data.latest._id);

  return (
    <Card>
      <CardHeader
        title="Before and after"
        subtitle="First check-in against the latest"
        action={
          <div className="w-40">
            <Select hideLabel label="Compare angle" aria-label="Compare angle" options={FILTER_OPTIONS} value={photoType} onChange={(v) => setPhotoType(v as '' | PhotoType)} />
          </div>
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="aspect-[3/4] w-full rounded-md" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : isError ? (
        <ErrorState error={error} title="Could not load your comparison" retry={() => refetch()} />
      ) : !hasPair || !data?.first || !data?.latest ? (
        <EmptyState
          size="sm"
          icon={<Camera size={24} />}
          title={photoType ? `Two ${humanize(photoType).toLowerCase()} photos needed` : 'Two check-ins needed'}
          message="Add a second check-in from the same angle and the before-and-after slider appears here."
        />
      ) : (
        <div className="space-y-4" aria-busy={isFetching || undefined}>
          <ComparisonSlider before={data.first} after={data.latest} />

          <StatGrid columns={4}>
            <StatTile label="Days between" value={formatStat(data.daysBetween ?? 0)} unit={data.daysBetween === 1 ? 'day' : 'days'} />
            <StatTile
              label="Weight change"
              value={weightChange == null ? '—' : signed(weightChange)}
              unit={weightChange == null ? undefined : 'kg'}
              icon={weightChange == null || weightChange === 0 ? undefined : weightChange < 0 ? <TrendingDown size={18} /> : <TrendingUp size={18} />}
              hint={weightChange == null ? 'Add weight to both check-ins' : undefined}
            />
            <StatTile label="First weight" value={data.first.weight != null ? formatStat(data.first.weight) : '—'} unit={data.first.weight != null ? 'kg' : undefined} hint={fmtDate(data.first.date)} />
            <StatTile label="Latest weight" value={data.latest.weight != null ? formatStat(data.latest.weight) : '—'} unit={data.latest.weight != null ? 'kg' : undefined} hint={fmtDate(data.latest.date)} />
          </StatGrid>

          {changes ? (
            <div>
              <p className="type-label mb-2 text-text-2">Measurement changes in cm</p>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {MEASUREMENT_KEYS.map((key) => {
                  const raw = changes[key];
                  const valid = raw != null && Number.isFinite(Number(raw));
                  const delta = valid ? Number(raw) : Number.NaN;
                  return (
                    <div key={key} className="rounded-md bg-surface-2 p-3">
                      <dt className="type-label text-text-2">{humanize(key)}</dt>
                      <dd className="type-stat mt-1 inline-flex items-center gap-1 text-xl text-text-1">
                        {valid ? signed(delta) : '—'}
                        {valid && delta !== 0 ? (
                          <span className="text-text-3">{delta < 0 ? <TrendingDown size={16} /> : <TrendingUp size={16} />}</span>
                        ) : null}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/* --------------------------------------------------------------- gallery */

function PhotoCard({ photo, onEdit, onDelete }: { photo: ProgressPhoto; onEdit: () => void; onDelete: () => void }) {
  const measurements = photo.measurements ? MEASUREMENT_KEYS.filter((key) => photo.measurements?.[key] != null) : [];
  const dateLabel = fmtDate(photo.date);

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="relative aspect-[3/4] w-full bg-surface-2">
        <img src={mediaUrl(photo.photo_url)} alt={`${humanize(photo.photo_type ?? 'front')} progress photo from ${dateLabel}`} className="h-full w-full object-cover" loading="lazy" />
        <div className="absolute top-2 right-2 flex gap-1">
          <IconButton label={`Edit check-in from ${dateLabel}`} variant="secondary" className="shadow-2" onClick={onEdit}>
            <Edit size={16} />
          </IconButton>
          <IconButton label={`Delete check-in from ${dateLabel}`} variant="secondary" className="text-danger shadow-2" onClick={onDelete}>
            <Trash size={16} />
          </IconButton>
        </div>
        <Badge tone="neutral" className="absolute top-2 left-2 bg-surface-1 shadow-2">
          {humanize(photo.photo_type ?? 'front')}
        </Badge>
      </div>
      <div className="space-y-1.5 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 text-xs text-text-2">
            <Calendar size={13} className="text-text-3" /> {dateLabel}
          </p>
          {photo.weight != null ? (
            <p className="type-stat text-md text-text-1">
              {formatStat(photo.weight)}
              <span className="ml-0.5 text-2xs font-semibold text-text-2 [font-variation-settings:'wdth'_100]">kg</span>
            </p>
          ) : null}
        </div>
        {measurements.length ? (
          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-2">
            {measurements.map((key) => (
              <span key={key}>
                {humanize(key)} <span className="tabular font-semibold text-text-1">{formatStat(photo.measurements?.[key] ?? 0)}</span>
              </span>
            ))}
          </p>
        ) : null}
        {photo.notes ? <p className="line-clamp-3 text-xs leading-relaxed text-text-2">{photo.notes}</p> : null}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------- page */

export default function ProgressPhotos() {
  const qc = useQueryClient();
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const compact = useIsCompact();
  const [tab, setTab] = useState<'gallery' | 'comparison'>('gallery');
  const [filter, setFilter] = useState<'' | PhotoType>('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProgressPhoto | null>(null);

  const listKey = useMemo(() => ['progress-photos', 'list', filter], [filter]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: listKey,
    queryFn: async (): Promise<ProgressPhoto[]> => {
      const { data } = await api.get<ProgressPhoto[]>('/progress-photos', {
        params: { limit: 60, ...(filter ? { photo_type: filter } : {}) },
      });
      return Array.isArray(data) ? data : [];
    },
  });

  const remove = useMutation({
    mutationFn: async (photo: ProgressPhoto) => {
      await api.delete(`/progress-photos/${photo._id}`);
      return photo._id;
    },
    onSuccess: () => {
      toast.success('Check-in deleted');
      qc.invalidateQueries({ queryKey: PHOTOS_KEY });
      setPendingDelete(null);
    },
    onError: (e) => toast.error(errMsg(e, 'Could not delete this check-in')),
  });

  const photos = data ?? [];
  const weighted = photos.filter((p) => p.weight != null);
  const latestWeight = weighted[0]?.weight ?? null;
  const weightSpark = [...weighted].reverse().map((p) => p.weight as number);
  const firstWeight = weighted.length > 1 ? (weighted[weighted.length - 1].weight as number) : null;
  const weightDelta = latestWeight != null && firstWeight != null ? Math.round((latestWeight - firstWeight) * 10) / 10 : null;
  const lastDate = photos[0] ? parseISO(photos[0].date) : null;
  const daysSince = lastDate && isValid(lastDate) ? Math.max(0, differenceInCalendarDays(new Date(), lastDate)) : null;

  const firstName = (user?.fullName || user?.username || '').trim().split(/\s+/)[0];

  const newButton = (
    <Button variant="primary" icon={<Camera size={18} />} onClick={() => setUploadOpen(true)}>
      New check-in
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Progress photos"
        subtitle={firstName ? `Proof of the work, ${firstName}. Track the change the scale misses.` : 'Proof of the work. Track the change the scale misses.'}
        actions={newButton}
        mobileActions={
          <IconButton label="New check-in" onClick={() => setUploadOpen(true)}>
            <Plus size={22} />
          </IconButton>
        }
      />

      <StatGrid columns={3}>
        <StatTile loading={isLoading} label="Check-ins" value={formatStat(photos.length)} icon={<Camera size={18} />} hint={filter ? `${humanize(filter)} angle only` : 'All angles'} />
        <StatTile
          loading={isLoading}
          label="Latest weight"
          value={latestWeight != null ? formatStat(latestWeight) : '—'}
          unit={latestWeight != null ? 'kg' : undefined}
          spark={compact ? undefined : weightSpark}
          delta={weightDelta != null ? { value: `${signed(weightDelta)} kg`, direction: 'flat', label: 'since day one' } : undefined}
          hint={latestWeight == null ? 'Add weight to a check-in' : undefined}
        />
        <StatTile
          loading={isLoading}
          label="Last check-in"
          value={daysSince == null ? '—' : daysSince === 0 ? 'Today' : formatStat(daysSince)}
          unit={daysSince == null || daysSince === 0 ? undefined : daysSince === 1 ? 'day ago' : 'days ago'}
          icon={<Calendar size={18} />}
          hint={photos[0] ? fmtDate(photos[0].date) : 'No check-ins yet'}
        />
      </StatGrid>

      <Tabs
        variant="segmented"
        fill
        aria-label="Progress photos view"
        active={tab}
        onChange={(key) => setTab(key as 'gallery' | 'comparison')}
        tabs={[
          { key: 'gallery', label: 'Gallery', icon: <Camera size={16} />, count: photos.length || undefined },
          { key: 'comparison', label: 'Compare', icon: <TrendingUp size={16} /> },
        ]}
        className="max-w-md"
      />

      {tab === 'comparison' ? (
        <ComparisonPanel />
      ) : (
        <section className="space-y-3" aria-label="All check-ins">
          <div className="flex items-center justify-between gap-3">
            <h2 className="type-heading shrink-0 whitespace-nowrap text-lg text-text-1">All check-ins</h2>
            <div className="w-40 shrink-0">
              <Select hideLabel label="Filter by angle" aria-label="Filter by angle" options={FILTER_OPTIONS} value={filter} onChange={(v) => setFilter(v as '' | PhotoType)} />
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="card overflow-hidden">
                  <Skeleton className="aspect-[3/4] w-full rounded-none" />
                  <div className="space-y-2 p-3">
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <ErrorState error={error} title="Could not load your progress photos" retry={() => refetch()} />
          ) : photos.length === 0 ? (
            <Card padded={false}>
              <EmptyState
                variant={filter ? 'no-results' : 'first-run'}
                title={filter ? `No ${humanize(filter).toLowerCase()} photos yet` : 'No check-ins yet'}
                message={filter ? 'Try another angle, or add a check-in from this one.' : 'Take your first check-in today: same spot, same light. Future you will want the baseline.'}
                action={{ label: filter ? 'Add a check-in' : 'Add your first check-in', onClick: () => setUploadOpen(true), icon: <Camera size={18} /> }}
                secondaryAction={filter ? { label: 'Show all angles', onClick: () => setFilter('') } : undefined}
              />
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {photos.map((photo) => (
                <PhotoCard key={photo._id} photo={photo} onEdit={() => setEditingId(photo._id)} onDelete={() => setPendingDelete(photo)} />
              ))}
            </div>
          )}
        </section>
      )}

      <Callout tone="info">Check-ins are listed only in your account. They never appear in your posts, feed or profile.</Callout>

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <EditModal photoId={editingId} onClose={() => setEditingId(null)} />

      <ConfirmDialog
        open={!!pendingDelete}
        destructive
        title="Delete this check-in?"
        message={pendingDelete ? `The photo from ${fmtDate(pendingDelete.date)} and its stats will be permanently removed.` : undefined}
        confirmLabel="Delete check-in"
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete);
        }}
      />
    </div>
  );
}
