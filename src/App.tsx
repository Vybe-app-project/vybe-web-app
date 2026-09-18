/// <reference types="vite-plugin-pwa/react" />
import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import Layout from './components/Layout';
import { PublicShell } from './components/PublicShell';
import { FullPageSpinner, ToastProvider, useThemeSync, useToast } from './components/ui';
import { useAuth } from './lib/auth';
import { lazyPage } from './lib/navigation';

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
const Profile = lazyPage('/profile', () => import('./pages/Profile'));
const UserProfile = lazyPage(null, () => import('./pages/UserProfile'));
const Settings = lazyPage('/settings', () => import('./pages/Settings'));
const Notifications = lazyPage('/notifications', () => import('./pages/Notifications'));
const Messages = lazyPage('/messages', () => import('./pages/Messages'));
const Friends = lazyPage('/friends', () => import('./pages/Friends'));
const Stories = lazyPage('/stories', () => import('./pages/Stories'));
const Gyms = lazyPage('/gyms', () => import('./pages/Gyms'));
const GymCommunity = lazyPage('/communities', () => import('./pages/GymCommunity'));
const Livestreams = lazyPage('/live', () => import('./pages/Livestreams'));
const Support = lazyPage('/support', () => import('./pages/Support'));
const OpenHandoff = lazyPage(null, () => import('./pages/OpenHandoff'));
const NotFound = lazyPage(null, () => import('./pages/NotFound'));

const Workouts = lazyPage('/workouts', () => import('./pages/Workouts'));
const WorkoutDetail = lazyPage(null, () => import('./pages/WorkoutDetail'));
const WorkoutLogs = lazyPage('/workouts/logs', () => import('./pages/WorkoutLogs'));
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

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));

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
const AdminCatalog = lazy(() => import('./pages/admin/AdminCatalog'));
const AdminCatalogWorkout = lazy(() => import('./pages/admin/AdminCatalogWorkout'));
const AdminCatalogPlan = lazy(() => import('./pages/admin/AdminCatalogPlan'));

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

/** Signed-in users skip auth pages; honour the `from` location RequireAuth stored. */
function GuestOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (user) {
    const from = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from;
    const target = from?.pathname && from.pathname !== '/login' ? `${from.pathname}${from.search ?? ''}` : '/';
    return <Navigate to={target} replace />;
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

/** Route changes should start at the top rather than inherit scroll. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

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

export default function App() {
  const bootstrap = useAuth((s) => s.bootstrap);
  useEffect(() => { void bootstrap(); }, [bootstrap]);
  useThemeSync();

  return (
    <ToastProvider>
      <ScrollToTop />
      <PwaUpdates />
      <Suspense fallback={<FullPageSpinner />}>
        <Routes>
          {/* Public auth */}
          <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
          <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
          <Route path="/forgot-password" element={<GuestOnly><ForgotPassword /></GuestOnly>} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Public help: works signed out, wears the app shell when signed in */}
          <Route path="/support" element={<SupportGate />} />
          {/* The API's transactional emails link to support.html (the old static page). */}
          <Route path="/support.html" element={<Navigate to="/support" replace />} />

          {/* Share links from the mobile app (and older web links): /open.html?type=…&id=… */}
          <Route path="/open.html" element={<OpenHandoff />} />
          <Route path="/open" element={<OpenHandoff />} />

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
            {/* A mistyped console URL stays in the console instead of falling through to the member sign-in. */}
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Route>

          {/* Authenticated app */}
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<Feed />} />
            <Route path="discover" element={<Discover />} />
            <Route path="search" element={<Search />} />
            <Route path="p/:postId" element={<PostDetail />} />
            <Route path="stories" element={<Stories />} />
            <Route path="profile" element={<Profile />} />
            <Route path="u/:id" element={<UserProfile />} />
            <Route path="settings" element={<Settings />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="messages" element={<Messages />} />
            <Route path="messages/:roomId" element={<Messages />} />
            <Route path="friends" element={<Friends />} />
            <Route path="gyms" element={<Gyms />} />
            <Route path="communities" element={<GymCommunity />} />
            <Route path="live" element={<Livestreams />} />
            <Route path="live/:streamId" element={<Livestreams />} />

            <Route path="workouts" element={<Workouts />} />
            <Route path="workouts/logs" element={<WorkoutLogs />} />
            <Route path="workouts/:workoutId" element={<WorkoutDetail />} />
            <Route path="meals" element={<Meals />} />
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

            {/* Aliases and legacy paths → canonical routes */}
            <Route path="create" element={<Navigate to="/?compose=1" replace />} />
            <Route path="post/:postId" element={<RedirectPost />} />
            <Route path="feed" element={<Navigate to="/" replace />} />
            <Route path="explore" element={<Navigate to="/discover" replace />} />
            <Route path="inbox" element={<Navigate to="/messages" replace />} />
            <Route path="meal-templates" element={<Navigate to="/meals/templates" replace />} />
            <Route path="health-goals" element={<Navigate to="/health/goals" replace />} />
            <Route path="water" element={<Navigate to="/health/water" replace />} />
            <Route path="workout-logs" element={<Navigate to="/workouts/logs" replace />} />
            <Route path="livestreams" element={<Navigate to="/live" replace />} />
            <Route path="livestreams/:streamId" element={<RedirectLive />} />
          </Route>

          {/* Unknown URLs get a not-found page (inside the shell when signed in), not a silent hop to Home. */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ToastProvider>
  );
}
