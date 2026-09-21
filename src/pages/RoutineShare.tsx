import { useLocation, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { PublicShell } from '../components/PublicShell';
import { Button, ButtonLink, Card, EmptyState, PageHeader, Skeleton, formatStat, useToast } from './ui';
import { Dumbbell, Layers, Lock } from './icons';

/**
 * /r/<id|token> — a routine someone shared by link. The API mints
 * `FRONTEND_URL/r/<token>` for a private routine (64-hex, shown once, stored
 * hashed) and a public routine also travels by its 24-hex id. Signed out, the
 * visitor sees the public preview (title, exercise count, minutes, the
 * author's first name — never a load or an exercise name) with a sign-in
 * hand-off; a member sees the same card inside the shell and can save the
 * routine into their own library (`POST /routines/:id/save`, private copy
 * with provenance). Both routes sit behind flags (`routineShareLinks`,
 * `programs`), so a 404 with `FEATURE_DISABLED` is a state here, not an error.
 */

const ID_OR_TOKEN = /^(?:[a-f0-9]{24}|[a-f0-9]{64})$/i;

type Preview = {
  id: string;
  kind: 'routine' | 'token';
  title: string;
  exerciseCount: number;
  durationMin: number | null;
  authorFirstName: string | null;
  image: string | null;
  storeUrls?: { ios?: string; android?: string };
};

type ApiError = { response?: { status?: number; data?: { code?: string; message?: string } } };
const codeOf = (e: unknown): string | null => (e as ApiError | null)?.response?.data?.code ?? null;

const previewMeta = (p: Preview): string =>
  [p.exerciseCount ? `${formatStat(p.exerciseCount)} ${p.exerciseCount === 1 ? 'exercise' : 'exercises'}` : null, p.durationMin ? `${formatStat(p.durationMin)} min` : null].filter(Boolean).join(' · ');

export default function RoutineShare({ member = false }: { member?: boolean }) {
  const { idOrToken = '' } = useParams();
  const location = useLocation();
  const toast = useToast();
  const valid = ID_OR_TOKEN.test(idOrToken);
  const from = { from: location };

  const preview = useQuery({
    queryKey: ['public-routine', idOrToken],
    enabled: valid,
    retry: false,
    queryFn: async () => {
      const { data } = await api.get<Preview>(`/public/routines/${idOrToken}`);
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const p = preview.data as Preview;
      const { data } = await api.post<{ routine?: { _id?: string } }>(`/routines/${p.id}/save`, p.kind === 'token' ? { token: idOrToken } : {});
      return data;
    },
    onSuccess: () => toast.success('Saved to your workouts'),
    onError: (e) => {
      if (codeOf(e) === 'FEATURE_DISABLED') toast.info('Saving a shared routine arrives with a later update.');
      else toast.error(errMsg(e, 'Could not save this routine'));
    },
  });

  const code = preview.isError ? codeOf(preview.error) : null;
  const unavailable = !valid || preview.isError;
  const copy =
    code === 'FEATURE_DISABLED'
      ? { title: 'Routine links aren’t available yet', message: 'Sharing a routine by link arrives with a later update. The workout library is open in the app meanwhile.' }
      : code === 'SHARE_LINK_NOT_FOUND'
        ? { title: 'This link has expired', message: 'Shared routine links stop working after 30 days or when the owner revokes them. Ask them for a new one.' }
        : { title: 'This routine isn’t available', message: 'It may be private, deleted, or shared from an account only followers can see.' };

  const body = unavailable ? (
    <EmptyState
      icon={<Lock size={26} />}
      variant="no-results"
      title={copy.title}
      message={copy.message}
      action={member ? { label: 'Open workouts', to: '/workouts' } : { label: 'Log in', to: '/login', state: from }}
      secondaryAction={member ? undefined : { label: 'Join Vybe', to: '/register', state: from }}
    />
  ) : preview.isLoading || !preview.data ? (
    <Card aria-busy="true" aria-label="Loading routine">
      <div className="flex items-start gap-3">
        <Skeleton className="h-12 w-12 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <Skeleton className="mt-4 h-11 w-full rounded-sm" />
    </Card>
  ) : (
    <Card className="space-y-4">
      {preview.data.image ? <img src={preview.data.image} alt="" className="aspect-[16/9] w-full rounded-md object-cover" /> : null}
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-text-2">
          <Dumbbell size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="t-title text-text-1">{preview.data.title}</h2>
          {previewMeta(preview.data) ? <p className="t-meta tabular">{previewMeta(preview.data)}</p> : null}
          {preview.data.authorFirstName ? <p className="t-meta">Shared by {preview.data.authorFirstName}</p> : null}
        </div>
      </div>
      {member ? (
        <Button variant="primary" block loading={save.isPending} icon={<Layers size={18} />} onClick={() => save.mutate()}>
          Save to my workouts
        </Button>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <ButtonLink to="/login" state={from} variant="primary" block>
            Log in to save it
          </ButtonLink>
          <ButtonLink to="/register" state={from} variant="secondary" block>
            Join Vybe
          </ButtonLink>
        </div>
      )}
    </Card>
  );

  if (member) {
    return (
      <div className="space-y-section lg:max-w-form">
        <PageHeader title="Shared routine" />
        {body}
      </div>
    );
  }
  return (
    <PublicShell title="Shared on Vybe" subtitle="A workout routine someone shared with you.">
      {body}
    </PublicShell>
  );
}
