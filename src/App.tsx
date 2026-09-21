/// <reference types="vite-plugin-pwa/react" />
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigationType, useParams, useSearchParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import Layout from './components/Layout';
import { PublicShell } from './components/PublicShell';
import { useQueryClient } from '@tanstack/react-query';
import { RouteErrorBoundary } from './components/ErrorBoundary';
import { ApiNotices } from './components/ApiNotices';
import { UpdateRequiredScreen } from './components/UpdateRequiredScreen';
import { LegalConsentGate } from './components/LegalConsentGate';
import { postLoginTarget } from './lib/authRedirect';
import WelcomeSheet from './pages/WelcomeSheet';
import { FullPageSpinner, ToastProvider, useThemeSync, useToast } from './components/ui';
import { useAuth, useSessionRefresh } from './lib/auth';
import { AccountPreferencesSync } from './lib/accountPreferences';
import { lazyPage } from './lib/navigation';
import { SHEET_MEDIA, backgroundLocationOf } from './components/RouteSheet';
import { useMediaQuery } from './components/ui';

/**
 * Every feature page is code-split. The app has ~35 screens and a single
 * bundle would make first paint on mobile noticeably worse, which matters
 * because this same origin backs the iOS web views.
 *
 * Consumer pages go through lazyPage (lib/navigation.ts): each loader is
 * registered by path so the shell can warm a chunk when the user shows
 * intent (pointer down / hover on a nav link) and the tab roots while the
 * browser is idle, and a warmed page renders without suspending, so the
 * skeleton only ever shows for a chunk that is genuinely still downloading.
 */
const Feed = lazyPage('/', () => import('./pages/Feed'));
const Discover = lazyPage('/discover', () => import('./pages/Discover'));
const Search = lazyPage('/search', () => import('./pages/Search'));
const PostDetail = lazyPage(null, () => import('./pages/PostDetail'));
const PublicPost = lazyPage(null, () => import('./pages/PublicPost'));
const Profile = lazyPage('/profile', () => import('./pages/Profile'));
const UserProfile = lazyPage(null, () => import('./pages/UserProfile'));
const Connections = lazyPage(null, () => import('./pages/Connections'));
const Settings = lazyPage('/settings', () => import('./pages/Settings'));
const Notifications = lazyPage('/notifications', () => import('./pages/Notifications'));
const Messages = lazyPage('/messages', () => import('./pages/Messages'));
const Friends = lazyPage('/friends', () => import('./pages/Friends'));
const Stories = lazyPage('/stories', () => import('./pages/Stories'));
const Gyms = lazyPage('/gyms', () => import('./pages/Gyms'));
// Gym page (P6): the band's full expression, with the gym-scoped tabs on the band.
const GymDetail = lazyPage(null, () => import('./pages/GymDetail'));
const GymCommunity = lazyPage('/communities', () => import('./pages/GymCommunity'));
const CommunityDetail = lazyPage(null, () => import('./pages/CommunityDetail'));
const Livestreams = lazyPage('/live', () => import('./pages/Livestreams'));
const Support = lazyPage('/support', () => import('./pages/Support'));
const OpenHandoff = lazyPage(null, () => import('./pages/OpenHandoff'));
// Together-session landing: the module's default export is its own auth gate (signed out: sign-in hand-off; signed in: the shell).
const SessionGate = lazyPage(null, () => import('./pages/SessionInvite'));
const NotFound = lazyPage(null, () => import('./pages/NotFound'));
const EmailUnsubscribe = lazyPage(null, () => import('./pages/EmailUnsubscribe'));
// Invite landing (/join/<code>): the public preview for a recipient who may not have the app; redemption is the app's.
const JoinInvite = lazyPage(null, () => import('./pages/JoinInvite'));

const Workouts = lazyPage('/workouts', () => import('./pages/Workouts'));
const WorkoutDetail = lazyPage(null, () => import('./pages/WorkoutDetail'));
const WorkoutPlanDetail = lazyPage(null, () => import('./pages/WorkoutPlanDetail'));
// Train › History (was "Workout log"). /workouts/logs redirects here, query and hash preserved.
const WorkoutHistory = lazyPage('/workouts/history', () => import('./pages/WorkoutHistory'));
// Detail/editor routes presented through RouteSheet (a sheet over the parent on lg+, a page on phones).
const WorkoutEditor = lazyPage(null, () => import('./pages/workouts/WorkoutEditor'));
const PlanEditor = lazyPage(null, () => import('./pages/workouts/PlanEditor'));
const SessionDetail = lazyPage(null, () => import('./pages/workouts/SessionDetail'));
const MealLog = lazyPage(null, () => import('./pages/MealLog'));
const WorkoutProgress = lazyPage('/workouts/progress', () => import('./pages/WorkoutProgress'));
const Meals = lazyPage('/meals', () => import('./pages/Meals'));
const MealDetail = lazyPage(null, () => import('./pages/MealDetail'));
const SharedMeal = lazyPage(null, () => import('./pages/SharedMeal'));
const MealTemplates = lazyPage('/meals/templates', () => import('./pages/MealTemplates'));
const WeeklyPlans = lazyPage('/meals/plans', () => import('./pages/WeeklyPlans'));
const Health = lazyPage('/health', () => import('./pages/Health'));
const HealthGoals = lazyPage('/health/goals', () => import('./pages/HealthGoals'));
const Water = lazyPage('/health/water', () => import('./pages/Water'));
const ProgressPhotos = lazyPage('/health/photos', () => import('./pages/ProgressPhotos'));
const Challenges = lazyPage('/challenges', () => import('./pages/Challenges'));
const Achievements = lazyPage('/achievements', () => import('./pages/Achievements'));
const Recaps = lazyPage('/recaps', () => import('./pages/Recaps'));
const RecapDetail = lazyPage(null, () => import('./pages/RecapDetail'));

const Login = lazyPage(null, () => import('./pages/Login'));
const Register = lazyPage(null, () => import('./pages/Register'));
const ForgotPassword = lazyPage(null, () => import('./pages/ForgotPassword'));
const ResetPassword = lazyPage(null, () => import('./pages/ResetPassword'));

const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'));
const AdminForgotPassword = lazy(() => import('./pages/admin/AdminForgotPassword'));
const AdminResetPassword = lazy(() => import('./pages/admin/AdminResetPassword'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminPosts = lazy(() => import('./pages/admin/AdminPosts'));
const AdminReports = lazy(() => import('./pages/admin/AdminReports'));
const AdminSupport = lazy(() => import('./pages/admin/AdminSupport'));
const AdminTrainers = lazy(() => import('./pages/admin/AdminTrainers'));
const AdminAdmins = lazy(() => import('./pages/admin/AdminAdmins'));
const AdminAudit = lazy(() => import('./pages/admin/AdminAudit'));
const AdminSystem = lazy(() => import('./pages/admin/AdminSystem'));
// Feature flags (Wave G admin contract): GET /api/admin/flags and PUT /api/admin/flags/:name.
const AdminFlags = lazy(() => import('./pages/admin/AdminFlags'));
const AdminCatalog = lazy(() => import('./pages/admin/AdminCatalog'));
const AdminCatalogWorkout = lazy(() => import('./pages/admin/AdminCatalogWorkout'));
const AdminCatalogPlan = lazy(() => import('./pages/admin/AdminCatalogPlan'));

/**
 * Keys the foreground refresh leaves alone: the account refreshes through
 * `refreshUser` itself, the home gym follows the account's pointer (its own
 * signature effect), the capability flags and the API build are pinned for
 * the session, and a community's page cache is served from the shell's fetch.
 * Invalidating these on every return to the tab re-ran the gym lookup and
 * Home's top quarter went back to a skeleton.
 */
const SESSION_STABLE_KEYS = new Set(['me', 'home-gym', 'community', 'capabilities', 'api-version']);

/**
 * Refresh the session user on foreground/interval. After a long absence the
 * time-sensitive queries on screen refetch in the background with their data
 * kept — active queries only, never a reset — so nothing on screen goes back
 * to a skeleton while the fresh answer arrives.
 */
function SessionRefresh() {
  const qc = useQueryClient();
  const onStale = useCallback(() => {
    void qc.invalidateQueries({
      refetchType: 'active',
      predicate: (query) => query.state.status === 'success' && !SESSION_STABLE_KEYS.has(String(query.queryKey[0])),
    });
  }, [qc]);
  useSessionRefresh(onStale);
  return null;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  // Preserve the attempted destination so login can bounce the user back.
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { admin, adminLoading, bootstrapAdmin } = useAuth();
  useEffect(() => { void bootstrapAdmin(); }, [bootstrapAdmin]);
  if (adminLoading) return <FullPageSpinner />;
  if (!admin) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}

/**
 * Signed-in users skip auth pages. The redirect target is computed by the
 * same rule Login uses (router `from` state, then `?next=`, then Home): this
 * guard renders the moment the store has a user, so if it disagreed with the
 * page -- as it did when it ignored `?next=` -- its redirect always won.
 */
function GuestOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  if (loading) return <FullPageSpinner />;
  if (user) {
    const from = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from;
    return <Navigate to={postLoginTarget({ from, next: params.get('next') })} replace />;
  }
  return <>{children}</>;
}

/**
 * Support must work without an account: the iOS app and the store listings
 * link straight to /support, and App Review loads the support URL signed out.
 * Signed-in users get the same form inside the app shell.
 */
function SupportGate() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (user) {
    return (
      <Layout>
        <Support />
      </Layout>
    );
  }
  return (
    <PublicShell
      title="Support"
      subtitle="Report a problem, ask a question or share feedback. We usually reply within two business days."
    >
      <Support standalone />
    </PublicShell>
  );
}

/**
 * Shared post links (/p/:id) must open for people without an account: the
 * link is what gets pasted into chats. Members get the full detail page in the
 * app shell; everyone else gets the public post with a sign-in call to action,
 * and login still bounces back here because the CTA carries the location.
 */
function PostGate() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (user) {
    return (
      <Layout>
        <PostDetail />
      </Layout>
    );
  }
  return <PublicPost />;
}

/** Scroll offset per history entry (`location.key`: the same path twice in the stack keeps two positions). */
const scrollPositions = new Map<string, number>();
/** How many frames a restore may retry while the page grows back to the height it had. */
const RESTORE_FRAMES = 20;

/**
 * Scroll on route change. A forward navigation starts at the top; Back and
 * Forward (POP) return to where that entry was, so leaving a post does not
 * dump you at the top of the feed; a sheet opening or closing over its parent
 * on a wide screen leaves the parent where it was (on phones the same route
 * is an ordinary page and scrolls like one). The browser's own restoration is
 * off: it fires before React has rendered the page, lands somewhere else and
 * then fights the route change. Restoring runs in a layout effect, before the
 * new frame paints, and retries for a few frames when the page has not grown
 * back to its height yet (its data is cached, its images are not).
 */
function ScrollRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const wide = useMediaQuery(SHEET_MEDIA);
  const sheet = wide && !!backgroundLocationOf(location);
  const wasSheet = useRef(sheet);

  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  }, []);

  // Remember where this entry is as it scrolls. (Saving in a cleanup would
  // run after the next route's layout effect has already scrolled to 0.)
  useEffect(() => {
    const key = location.key;
    const save = () => scrollPositions.set(key, window.scrollY);
    save();
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, [location.key]);

  useLayoutEffect(() => {
    const overSheet = sheet || wasSheet.current;
    wasSheet.current = sheet;
    if (overSheet) return;
    if (navigationType === 'POP') {
      const y = scrollPositions.get(location.key);
      // A reload or a fresh tab has nothing saved: leave the page where it is.
      if (y === undefined) return;
      let frames = 0;
      let raf = 0;
      const restore = () => {
        window.scrollTo(0, y);
        frames += 1;
        if (Math.abs(window.scrollY - y) > 1 && frames < RESTORE_FRAMES) raf = requestAnimationFrame(restore);
      };
      restore();
      return () => cancelAnimationFrame(raf);
    }
    window.scrollTo(0, 0);
  }, [location.key, navigationType, sheet]);
  return null;
}

/** /workouts/logs → /workouts/history, keeping ?log=1 and #day-… anchors that shipped in links. */
function RedirectHistory() {
  const { search, hash } = useLocation();
  return <Navigate to={`/workouts/history${search}${hash}`} replace />;
}

/**
 * Detail routes that present as a sheet over their parent on lg+ (RouteSheet).
 * Listed once: the main <Routes> renders them as pages inside the shell; when a
 * link opened one with `sheetState(location)`, the main <Routes> keeps showing
 * the background location and this list renders the sheet on top.
 */
const SHEET_ROUTES: Array<{ path: string; element: ReactNode }> = [
  { path: 'workouts/new', element: <WorkoutEditor /> },
  { path: 'workouts/:workoutId/edit', element: <WorkoutEditor /> },
  { path: 'workouts/plans/new', element: <PlanEditor /> },
  { path: 'workouts/plans/:planId/edit', element: <PlanEditor /> },
  { path: 'workouts/history/:logId', element: <SessionDetail /> },
  { path: 'meals/log', element: <MealLog /> },
];

/** Legacy paths that shipped in links: keep them working while pages migrate. */
function RedirectPost() {
  const { postId } = useParams();
  return <Navigate to={postId ? `/p/${postId}` : '/'} replace />;
}

function RedirectLive() {
  const { streamId } = useParams();
  return <Navigate to={streamId ? `/live/${streamId}` : '/live'} replace />;
}

/** Service-worker lifecycle: prompt to reload when a new build is waiting. */
function PwaUpdates() {
  const toast = useToast();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.warn('Service worker registration failed', error);
    },
  });
  useEffect(() => {
    if (!needRefresh) return;
    toast.info('A new version of Vybe is ready.', {
      action: { label: 'Reload', onClick: () => void updateServiceWorker(true) },
      duration: 60_000,
    });
    setNeedRefresh(false);
  }, [needRefresh, setNeedRefresh, toast, updateServiceWorker]);
  return null;
}

/** Every route, in one place, so AppRoutes can render it against a background location too. */
const ROUTE_TREE = (
  <>
    {/* Public auth */}
    <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
    <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
    <Route path="/forgot-password" element={<GuestOnly><ForgotPassword /></GuestOnly>} />
    <Route path="/reset-password" element={<ResetPassword />} />

    {/* Public help: works signed out, wears the app shell when signed in */}
    <Route path="/support" element={<SupportGate />} />
    {/* The API's transactional emails link to support.html (the old static page). */}
    <Route path="/support.html" element={<Navigate to="/support" replace />} />
    {/* One-click email unsubscribe. No account: the token in the path (or ?token=) is the credential; the page POSTs it to /api/email/unsubscribe after one confirm. */}
    <Route path="/unsubscribe/:token" element={<EmailUnsubscribe />} />
    <Route path="/unsubscribe" element={<EmailUnsubscribe />} />
    <Route path="/email/unsubscribe/:token" element={<EmailUnsubscribe />} />
    <Route path="/email/unsubscribe" element={<EmailUnsubscribe />} />

    {/* Shared post links work signed out (public preview) and wear the shell when signed in */}
    <Route path="/p/:postId" element={<PostGate />} />

    {/* Together-session invite landing: works signed out (sign-in hand-off), wears the shell when signed in. The param is a session id or the API's invite token. */}
    <Route path="/session/:id" element={<SessionGate />} />
    <Route path="/session/invite/:token" element={<SessionGate />} />

    {/* Share links from the mobile app (and older web links): /open.html?type=…&id=… */}
    <Route path="/open.html" element={<OpenHandoff />} />
    <Route path="/open" element={<OpenHandoff />} />

    {/* Invite landing: /join/<code> is the universal link an inviter shares (AASA /join/*); /join?code= is the hand-built form. Public: GET /api/public/invites/:code needs no account, and the code is shown in plain text for the app. */}
    <Route path="/join/:code" element={<JoinInvite />} />
    <Route path="/join" element={<JoinInvite />} />

    {/* Admin: the three signed-out surfaces sit outside RequireAdmin */}
    <Route path="/admin/login" element={<AdminLogin />} />
    <Route path="/admin/forgot-password" element={<AdminForgotPassword />} />
    <Route path="/admin/reset-password" element={<AdminResetPassword />} />
    <Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
      <Route index element={<AdminDashboard />} />
      <Route path="users" element={<AdminUsers />} />
      <Route path="posts" element={<AdminPosts />} />
      <Route path="reports" element={<AdminReports />} />
      <Route path="support" element={<AdminSupport />} />
      <Route path="trainers" element={<AdminTrainers />} />
      {/* Premade workout / plan catalog: list, then one editor route per kind ("new" or an id). */}
      <Route path="catalog" element={<AdminCatalog />} />
      <Route path="catalog/workouts/new" element={<AdminCatalogWorkout />} />
      <Route path="catalog/workouts/:workoutId" element={<AdminCatalogWorkout />} />
      <Route path="catalog/plans/new" element={<AdminCatalogPlan />} />
      <Route path="catalog/plans/:planId" element={<AdminCatalogPlan />} />
      <Route path="admins" element={<AdminAdmins />} />
      <Route path="audit" element={<AdminAudit />} />
      <Route path="system" element={<AdminSystem />} />
      <Route path="flags" element={<AdminFlags />} />
      {/* Unknown console URLs stay in the console. */}
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Route>

    {/* Authenticated app. The first-run sheet answers /?welcome=1 on any route. */}
    <Route element={<RequireAuth><Layout /><WelcomeSheet /></RequireAuth>}>
      <Route index element={<Feed />} />
      <Route path="discover" element={<Discover />} />
      <Route path="search" element={<Search />} />
      <Route path="stories" element={<Stories />} />
      <Route path="profile" element={<Profile />} />
      <Route path="u/:id" element={<UserProfile />} />
      {/* Followers / Following lists: your own under /profile, anyone else's under their profile. */}
      <Route path="profile/:kind" element={<Connections />} />
      <Route path="u/:id/:kind" element={<Connections />} />
      <Route path="settings" element={<Settings />} />
      <Route path="notifications" element={<Notifications />} />
      <Route path="messages" element={<Messages />} />
      <Route path="messages/:roomId" element={<Messages />} />
      <Route path="friends" element={<Friends />} />
      <Route path="gyms" element={<Gyms />} />
      <Route path="gyms/:gymId" element={<GymDetail />} />
      <Route path="communities" element={<GymCommunity />} />
      <Route path="communities/:communityId" element={<CommunityDetail />} />
      <Route path="live" element={<Livestreams />} />
      <Route path="live/:streamId" element={<Livestreams />} />

      <Route path="workouts" element={<Workouts />} />
      <Route path="workouts/history" element={<WorkoutHistory />} />
      <Route path="workouts/logs" element={<RedirectHistory />} />
      <Route path="workouts/progress" element={<WorkoutProgress />} />
      {/* Detail and editor routes (RouteSheet); static paths before the :param routes below. */}
      {SHEET_ROUTES.map((r) => (
        <Route key={r.path} path={r.path} element={r.element} />
      ))}
      <Route path="workouts/plans/:planId" element={<WorkoutPlanDetail />} />
      <Route path="workouts/:workoutId" element={<WorkoutDetail />} />
      <Route path="meals" element={<Meals />} />
      {/* Community meals live on the Meals page as a tab; keep the noun URL working. */}
      <Route path="meals/community" element={<Navigate to="/meals?tab=community" replace />} />
      <Route path="meals/templates" element={<MealTemplates />} />
      <Route path="meals/plans" element={<WeeklyPlans />} />
      <Route path="meals/shared/:token" element={<SharedMeal />} />
      <Route path="meals/:id" element={<MealDetail />} />
      <Route path="health" element={<Health />} />
      <Route path="health/goals" element={<HealthGoals />} />
      <Route path="health/water" element={<Water />} />
      <Route path="health/photos" element={<ProgressPhotos />} />
      <Route path="challenges" element={<Challenges />} />
      <Route path="achievements" element={<Achievements />} />
      {/* Weekly and monthly recaps; /recaps/:id is also the mobile deep link. */}
      <Route path="recaps" element={<Recaps />} />
      <Route path="recaps/:id" element={<RecapDetail />} />

      {/* Aliases and legacy paths → canonical routes */}
      <Route path="create" element={<Navigate to="/?compose=1" replace />} />
      <Route path="post/:postId" element={<RedirectPost />} />
      <Route path="feed" element={<Navigate to="/" replace />} />
      <Route path="explore" element={<Navigate to="/discover" replace />} />
      <Route path="inbox" element={<Navigate to="/messages" replace />} />
      <Route path="meal-templates" element={<Navigate to="/meals/templates" replace />} />
      <Route path="health-goals" element={<Navigate to="/health/goals" replace />} />
      <Route path="water" element={<Navigate to="/health/water" replace />} />
      <Route path="workout-logs" element={<Navigate to="/workouts/history" replace />} />
      <Route path="livestreams" element={<Navigate to="/live" replace />} />
      <Route path="livestreams/:streamId" element={<RedirectLive />} />
    </Route>

    <Route path="*" element={<NotFound />} />
  </>
);

/**
 * The route tree against the real location, or against the background
 * location while a sheet is open on a wide screen (the sheet's own route then
 * renders on top, outside the shell). On phones the background is ignored and
 * the sheet route is an ordinary page.
 */
function AppRoutes() {
  const location = useLocation();
  const wide = useMediaQuery(SHEET_MEDIA);
  const background = wide ? backgroundLocationOf(location) : null;
  return (
    <>
      <Routes location={background ? { ...background, state: null, key: 'background' } : location}>{ROUTE_TREE}</Routes>
      {background ? (
        <RequireAuth>
          <Routes>
            {SHEET_ROUTES.map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
            <Route path="*" element={null} />
          </Routes>
        </RequireAuth>
      ) : null}
    </>
  );
}

export default function App() {
  const bootstrap = useAuth((s) => s.bootstrap);
  const sessionStale = useAuth((s) => s.sessionStale);
  useEffect(() => { void bootstrap(); }, [bootstrap]);
  // A session restored from the offline snapshot re-verifies itself as soon
  // as the connection returns, and keeps trying while the API is unreachable,
  // so nobody has to find a "Try again" button.
  useEffect(() => {
    if (!sessionStale) return;
    const retry = () => void bootstrap();
    window.addEventListener('online', retry);
    window.addEventListener('focus', retry);
    const timer = window.setInterval(retry, 30_000);
    return () => {
      window.removeEventListener('online', retry);
      window.removeEventListener('focus', retry);
      window.clearInterval(timer);
    };
  }, [sessionStale, bootstrap]);
  useThemeSync();

  return (
    <ToastProvider>
      <ScrollRestoration />
      <PwaUpdates />
      <UpdateRequiredScreen />
      {/* Terms / privacy re-consent for the signed-in account; root mount so SupportGate and PostGate are covered too. */}
      <LegalConsentGate />
      <ApiNotices />
      <SessionRefresh />
      <AccountPreferencesSync />
      <Suspense fallback={<FullPageSpinner />}>
        <RouteErrorBoundary>
          <AppRoutes />
        </RouteErrorBoundary>
      </Suspense>
    </ToastProvider>
  );
}
