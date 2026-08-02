import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, isValid, parseISO } from 'date-fns';
import { api, errMsg, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  uploadImage,
} from '../lib/hooks';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Modal,
  Skeleton,
  Spinner,
  Tabs,
  Textarea,
  cx,
  useToast,
} from '../components/ui';
import {
  Camera,
  Calendar,
  Edit,
  Image as ImageIcon,
  Plus,
  Trash,
  TrendingUp,
  Upload,
} from '../components/icons';

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
  measurementChanges?: Record<keyof Measurements, number> | null;
};

const PHOTO_TYPES: PhotoType[] = ['front', 'side', 'back', 'other'];
const MEASUREMENT_KEYS: (keyof Measurements)[] = [
  'chest',
  'waist',
  'hips',
  'arms',
  'thighs',
];

const PHOTOS_KEY = ['progress-photos'];

/* -------------------------------------------------------------- utilities */

const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  const d = parseISO(iso);
  return isValid(d) ? format(d, 'MMM d, yyyy') : '—';
};

const numberOrUndefined = (raw: string): number | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

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

function MetaFields({
  form,
  onChange,
  disabled,
}: {
  form: MetaForm;
  onChange: (next: MetaForm) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Weight (kg)"
          type="number"
          min={0}
          step="0.1"
          inputMode="decimal"
          placeholder="e.g. 74.5"
          value={form.weight}
          disabled={disabled}
          onChange={(e) => onChange({ ...form, weight: e.target.value })}
        />
        <label className="w-full">
          <span className="mb-1.5 block text-xs font-semibold text-[var(--color-muted)]">
            Angle
          </span>
          <select
            className="input-base capitalize"
            value={form.photo_type}
            disabled={disabled}
            onChange={(e) => onChange({ ...form, photo_type: e.target.value as PhotoType })}
          >
            {PHOTO_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold text-[var(--color-muted)]">
          Measurements (cm) — optional
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {MEASUREMENT_KEYS.map((key) => (
            <Input
              key={key}
              type="number"
              min={0}
              step="0.1"
              inputMode="decimal"
              placeholder={key}
              aria-label={key}
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
      </div>

      <Textarea
        label="Notes"
        rows={3}
        maxLength={1000}
        placeholder="How are you feeling? Anything worth remembering about this check-in…"
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

  useEffect(() => {
    if (open) return;
    setForm(emptyMeta());
    setStorageKey('');
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
      toast.error('Unsupported image format. Use JPEG, PNG, WebP or HEIC.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error('That image is larger than 10 MB.');
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadImage(file, 'posts');
      setStorageKey(uploaded.key);
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
      toast.success('Photo ready — add your stats and save.');
    } catch (e) {
      toast.error(errMsg(e, 'Image upload failed.'));
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
      toast.success('Progress photo saved');
      qc.invalidateQueries({ queryKey: PHOTOS_KEY });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not save progress photo')),
  });

  return (
    <Modal open={open} onClose={onClose} title="New progress photo" size="lg">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex h-44 w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-surface-2)] sm:w-44">
            {preview ? (
              <img src={preview} alt="Selected progress photo" className="h-full w-full object-cover" />
            ) : uploading ? (
              <Spinner size={22} />
            ) : (
              <ImageIcon size={26} />
            )}
          </div>
          <div className="flex flex-1 flex-col justify-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              className="hidden"
              onChange={(e) => handleFile(e.target.files)}
            />
            <Button
              type="button"
              variant="ghost"
              loading={uploading}
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={16} /> {storageKey ? 'Replace photo' : 'Choose photo'}
            </Button>
            <p className="text-xs text-[var(--color-muted)]">
              JPEG, PNG, WebP or HEIC · up to 10 MB. Shoot in the same spot and lighting each
              time for the cleanest comparison.
            </p>
          </div>
        </div>

        <MetaFields form={form} onChange={setForm} disabled={save.isPending} />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={save.isPending}
            disabled={!storageKey || uploading}
          >
            Save photo
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------- edit modal */

function EditModal({
  photoId,
  onClose,
}: {
  photoId: string | null;
  onClose: () => void;
}) {
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
      const { data } = await api.put<ProgressPhoto>(
        `/progress-photos/${photoId}`,
        serializeMeta(form),
      );
      return data;
    },
    onSuccess: () => {
      toast.success('Photo updated');
      qc.invalidateQueries({ queryKey: PHOTOS_KEY });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e, 'Could not update photo')),
  });

  return (
    <Modal open={!!photoId} onClose={onClose} title="Edit check-in" size="lg">
      {detail.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-44 w-full rounded-xl" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : detail.isError ? (
        <ErrorState
          error={detail.error}
          title="Could not load this photo"
          retry={() => detail.refetch()}
        />
      ) : detail.data ? (
        <form
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
              className="h-44 w-full rounded-xl object-cover sm:w-44"
              loading="lazy"
            />
            <div className="flex flex-col justify-center gap-1 text-sm">
              <p className="inline-flex items-center gap-1.5 text-[var(--color-muted)]">
                <Calendar size={13} /> {fmtDate(detail.data.date)}
              </p>
              <Badge tone="brand" className="w-fit capitalize">
                {detail.data.photo_type ?? 'front'}
              </Badge>
            </div>
          </div>

          <MetaFields form={form} onChange={setForm} disabled={update.isPending} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={update.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={update.isPending}>
              Save changes
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}

/* -------------------------------------------------------- comparison view */

function ComparisonSlider({
  before,
  after,
}: {
  before: ProgressPhoto;
  after: ProgressPhoto;
}) {
  const [position, setPosition] = useState(50);

  return (
    <div className="space-y-2">
      <div className="relative aspect-[3/4] w-full select-none overflow-hidden rounded-xl bg-black">
        <img
          src={mediaUrl(after.photo_url)}
          alt={`Latest progress photo from ${fmtDate(after.date)}`}
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        >
          <img
            src={mediaUrl(before.photo_url)}
            alt={`First progress photo from ${fmtDate(before.date)}`}
            className="h-full w-full object-cover"
            draggable={false}
          />
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90 shadow-lg"
          style={{ left: `${position}%` }}
        />
        <span className="pointer-events-none absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">
          Before · {fmtDate(before.date)}
        </span>
        <span className="pointer-events-none absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">
          After · {fmtDate(after.date)}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={position}
        aria-label="Before and after comparison slider"
        className="w-full accent-[var(--color-brand)]"
        onChange={(e) => setPosition(Number(e.target.value))}
      />
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

  return (
    <Card className="space-y-4 p-4">
      <CardHeader
        title="Before &amp; after"
        subtitle="Your first check-in against your most recent one."
        action={
          <label className="flex items-center gap-2">
            <span className="sr-only">Filter comparison by angle</span>
            <select
              className="input-base w-32 capitalize"
              value={photoType}
              onChange={(e) => setPhotoType(e.target.value as '' | PhotoType)}
            >
              <option value="">All angles</option>
              {PHOTO_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="aspect-[3/4] w-full rounded-xl" />
          <Skeleton className="h-4 w-40" />
        </div>
      ) : isError ? (
        <ErrorState
          error={error}
          title="Could not load your comparison"
          retry={() => refetch()}
        />
      ) : !data?.first || !data?.latest || data.first._id === data.latest._id ? (
        <EmptyState
          icon={<TrendingUp size={24} />}
          title="Not enough photos yet"
          message="Upload at least two check-ins from the same angle and your before/after slider appears here."
        />
      ) : (
        <>
          <ComparisonSlider before={data.first} after={data.latest} />

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-[var(--color-surface-2)] p-3">
              <p className="text-xs text-[var(--color-muted)]">Days between</p>
              <p className="text-lg font-bold">{data.daysBetween ?? 0}</p>
            </div>
            <div className="rounded-xl bg-[var(--color-surface-2)] p-3">
              <p className="text-xs text-[var(--color-muted)]">Weight change</p>
              <p
                className={cx(
                  'text-lg font-bold',
                  weightChange == null
                    ? ''
                    : weightChange < 0
                      ? 'text-emerald-300'
                      : weightChange > 0
                        ? 'text-amber-300'
                        : '',
                )}
              >
                {weightChange == null
                  ? '—'
                  : `${weightChange > 0 ? '+' : ''}${weightChange.toFixed(1)} kg`}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--color-surface-2)] p-3">
              <p className="text-xs text-[var(--color-muted)]">First weight</p>
              <p className="text-lg font-bold">
                {data.first.weight != null ? `${data.first.weight} kg` : '—'}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--color-surface-2)] p-3">
              <p className="text-xs text-[var(--color-muted)]">Latest weight</p>
              <p className="text-lg font-bold">
                {data.latest.weight != null ? `${data.latest.weight} kg` : '—'}
              </p>
            </div>
          </div>

          {changes ? (
            <div>
              <p className="mb-2 text-sm font-semibold">Measurement changes (cm)</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {MEASUREMENT_KEYS.map((key) => {
                  const delta = Number(changes[key]);
                  const valid = Number.isFinite(delta);
                  return (
                    <div key={key} className="rounded-lg bg-[var(--color-surface-2)] p-2 text-center">
                      <p className="text-[11px] text-[var(--color-muted)] capitalize">{key}</p>
                      <p
                        className={cx(
                          'text-sm font-bold',
                          !valid || delta === 0
                            ? ''
                            : delta < 0
                              ? 'text-emerald-300'
                              : 'text-amber-300',
                        )}
                      >
                        {valid ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : '—'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {isFetching ? (
            <p className="inline-flex items-center gap-2 text-xs text-[var(--color-muted)]">
              <Spinner size={12} /> Refreshing…
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}

/* --------------------------------------------------------------- gallery */

function PhotoCard({
  photo,
  onEdit,
  onDelete,
}: {
  photo: ProgressPhoto;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const measurements = photo.measurements
    ? MEASUREMENT_KEYS.filter((key) => photo.measurements?.[key] != null)
    : [];

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="relative aspect-[3/4] w-full bg-[var(--color-surface-2)]">
        <img
          src={mediaUrl(photo.photo_url)}
          alt={`Progress photo from ${fmtDate(photo.date)}`}
          className="h-full w-full object-cover"
          loading="lazy"
        />
        <div className="absolute top-2 right-2 flex gap-1">
          <IconButton label="Edit check-in" onClick={onEdit}>
            <Edit size={15} />
          </IconButton>
          <IconButton label="Delete check-in" onClick={onDelete}>
            <Trash size={15} />
          </IconButton>
        </div>
        <Badge tone="brand" className="absolute top-2 left-2 capitalize">
          {photo.photo_type ?? 'front'}
        </Badge>
      </div>
      <div className="space-y-1.5 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
            <Calendar size={12} /> {fmtDate(photo.date)}
          </p>
          {photo.weight != null ? (
            <span className="text-sm font-bold">{photo.weight} kg</span>
          ) : null}
        </div>
        {measurements.length ? (
          <p className="text-[11px] text-[var(--color-muted)]">
            {measurements
              .map((key) => `${key} ${photo.measurements?.[key]}cm`)
              .join(' · ')}
          </p>
        ) : null}
        {photo.notes ? (
          <p className="line-clamp-3 text-xs leading-relaxed text-[var(--color-muted)]">
            {photo.notes}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------- page */

export default function ProgressPhotos() {
  const qc = useQueryClient();
  const toast = useToast();
  const user = useAuth((s) => s.user);
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
      toast.success('Photo deleted');
      qc.invalidateQueries({ queryKey: PHOTOS_KEY });
      setPendingDelete(null);
    },
    onError: (e) => toast.error(errMsg(e, 'Could not delete photo')),
  });

  const photos = data ?? [];
  const latestWeight = photos.find((p) => p.weight != null)?.weight ?? null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Progress photos</h1>
          <p className="text-sm text-[var(--color-muted)]">
            {user?.fullName || user?.username
              ? `Visual proof of the work, ${user.fullName || user.username}.`
              : 'Visual proof of the work — track the change the scale misses.'}
          </p>
        </div>
        <Button variant="primary" onClick={() => setUploadOpen(true)}>
          <Plus size={16} /> New photo
        </Button>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <Card className="p-3">
          <p className="text-xs text-[var(--color-muted)]">Check-ins</p>
          <p className="text-xl font-bold">{isLoading ? '—' : photos.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-[var(--color-muted)]">Latest weight</p>
          <p className="text-xl font-bold">
            {latestWeight != null ? `${latestWeight} kg` : '—'}
          </p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-[var(--color-muted)]">Last check-in</p>
          <p className="text-xl font-bold">
            {photos[0] ? fmtDate(photos[0].date) : '—'}
          </p>
        </Card>
      </div>

      <Tabs
        fill
        active={tab}
        onChange={(key) => setTab(key as 'gallery' | 'comparison')}
        tabs={[
          { key: 'gallery', label: 'Gallery', icon: <Camera size={15} />, count: photos.length },
          { key: 'comparison', label: 'Comparison', icon: <TrendingUp size={15} /> },
        ]}
      />

      {tab === 'comparison' ? (
        <ComparisonPanel />
      ) : (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">All check-ins</h2>
            <label className="flex items-center gap-2">
              <span className="sr-only">Filter photos by angle</span>
              <select
                className="input-base w-32 capitalize"
                value={filter}
                onChange={(e) => setFilter(e.target.value as '' | PhotoType)}
              >
                <option value="">All angles</option>
                {PHOTO_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="aspect-[3/4] w-full rounded-xl" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <ErrorState
              error={error}
              title="Could not load your progress photos"
              retry={() => refetch()}
            />
          ) : photos.length === 0 ? (
            <EmptyState
              icon={<Camera size={24} />}
              title={filter ? `No ${filter} photos yet` : 'No progress photos yet'}
              message="Take your first check-in today — same spot, same light. Future you will thank you."
              action={
                <Button variant="primary" onClick={() => setUploadOpen(true)}>
                  <Plus size={16} /> Upload a photo
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {photos.map((photo) => (
                <PhotoCard
                  key={photo._id}
                  photo={photo}
                  onEdit={() => setEditingId(photo._id)}
                  onDelete={() => setPendingDelete(photo)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <EditModal photoId={editingId} onClose={() => setEditingId(null)} />

      <ConfirmDialog
        open={!!pendingDelete}
        destructive
        title="Delete this check-in?"
        message={
          pendingDelete
            ? `The photo from ${fmtDate(pendingDelete.date)} and its stats will be permanently removed.`
            : undefined
        }
        confirmLabel="Delete photo"
        loading={remove.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete);
        }}
      />
    </div>
  );
}
