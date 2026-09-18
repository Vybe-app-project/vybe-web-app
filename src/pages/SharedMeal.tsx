import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api, mediaUrl } from '../lib/api';
import { dayAndTime } from '../lib/timezone';
import { useAuth } from '../lib/auth';
import { Avatar, ButtonLink, Card, ErrorState, PageHeader, Skeleton } from './ui';
import { MacroLine, mealTypeLabel, type Meal } from './Meals';

type SharedMealResponse = { meal: Meal; expiresAt: string };

const TOKEN = /^[a-f0-9]{64}$/i;

/**
 * /meals/shared/:token — a meal shared by link (POST /meals/:id/share mints a
 * seven-day token; the API puts this URL in its response). The token, not the
 * meal id, is what grants access, so the page renders from the share endpoint
 * rather than redirecting to /meals/:id, which a recipient may not be allowed
 * to open.
 */
export default function SharedMeal() {
  const { token = '' } = useParams();
  const { user } = useAuth();
  const valid = TOKEN.test(token);
  const q = useQuery({
    queryKey: ['meal', 'shared', token],
    enabled: valid,
    retry: false,
    queryFn: async (): Promise<SharedMealResponse> => {
      const { data } = await api.get<SharedMealResponse>(`/meals/shared/${token}`);
      return data;
    },
  });

  if (!valid || q.isError) {
    const status = (q.error as { response?: { status?: number } } | undefined)?.response?.status;
    const forSomeoneElse = status === 403;
    return (
      <>
        <PageHeader title="Shared meal" back="/meals" />
        <ErrorState
          error={q.error}
          title={forSomeoneElse ? 'This meal was shared with someone else' : 'This shared meal is no longer available'}
          message={forSomeoneElse ? 'Only the person it was shared with can open it.' : 'Share links last seven days. Ask for a fresh one.'}
          action={
            <ButtonLink to="/meals" variant="secondary">
              Back to meals
            </ButtonLink>
          }
        />
      </>
    );
  }

  if (q.isLoading || !q.data) {
    return (
      <>
        <PageHeader title="Shared meal" back="/meals" />
        <div className="mx-auto w-full max-w-form">
          <Skeleton className="h-72 w-full rounded-lg" />
        </div>
      </>
    );
  }

  const { meal, expiresAt } = q.data;
  const owner = typeof meal.user === 'object' && meal.user ? meal.user : undefined;
  const ownerName = owner?.fullName || owner?.username;
  const isOwner = Boolean(user && owner && owner._id === user._id);
  // Same locale time-of-day format as the meal cards ("12:16 PM").
  const when = dayAndTime(meal.timestamp);

  return (
    <>
      <PageHeader title={meal.food_name} subtitle={`${mealTypeLabel(meal.meal_type)}${when ? ` · ${when}` : ''}`} back="/meals" />
      <div className="mx-auto w-full max-w-form space-y-4">
        <Card className="overflow-hidden p-0">
          {meal.image_url ? <img src={mediaUrl(meal.image_url)} alt="" className="aspect-[4/3] w-full object-cover" /> : null}
          <div className="space-y-3 p-4">
            <div className="lg:hidden">
              <h1 className="type-heading text-xl text-text-1">{meal.food_name}</h1>
              <p className="text-sm text-text-2">
                {mealTypeLabel(meal.meal_type)}
                {when ? ` · ${when}` : ''}
              </p>
            </div>
            {ownerName ? (
              <div className="flex items-center gap-2">
                <Avatar src={owner?.avatar} name={ownerName} size={32} />
                <p className="text-sm text-text-2">
                  Shared by <span className="font-semibold text-text-1">{ownerName}</span>
                </p>
              </div>
            ) : null}
            <MacroLine nutrition={meal.nutrition} />
            {meal.serving_size ? <p className="text-sm text-text-2">Serving: {meal.serving_size}</p> : null}
            <p className="text-xs text-text-3">This link works until {format(new Date(expiresAt), 'd MMM yyyy')}.</p>
            {isOwner ? (
              <ButtonLink to={`/meals/${meal._id}`} variant="secondary">
                Open in my meals
              </ButtonLink>
            ) : null}
          </div>
        </Card>
      </div>
    </>
  );
}
