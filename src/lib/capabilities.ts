import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './auth';

/**
 * GET /api/capabilities and /api/capabilities/authenticated: the server's
 * honest report of what is configured (`capabilities`), the client policy
 * for this build (`client`) and the feature flags evaluated for the caller
 * (`features`). docs/api-contract.md, "Client policy".
 */

/** The boolean-only provider and feature-capability map. */
export type ServerCapabilities = {
  livestreamRelay?: boolean;
  turnRelay?: boolean;
  [k: string]: unknown;
};

export type ClientPolicyRules = { minVersion: string | null; latestVersion: string | null; storeUrl: string | null };

export type ClientPolicyBlock = ClientPolicyRules & {
  platform: string | null;
  version: string | null;
  build: string | null;
  updateRequired: boolean;
  updateAvailable: boolean;
  message: string | null;
  platforms: Record<string, ClientPolicyRules>;
};

/** Flat dotted flag names, every value a boolean: features['telemetry.crashReports']. */
export type FeatureFlags = Record<string, boolean>;

export type CapabilitiesResponse = {
  capabilities: ServerCapabilities;
  client: ClientPolicyBlock | null;
  features: FeatureFlags;
};

/**
 * The four flags the API always reports, and their value until it has:
 * all false, which renders the honest disabled state rather than promising
 * a feature the server may then refuse.
 */
export const FEATURE_DEFAULTS: Readonly<FeatureFlags> = Object.freeze({
  live: false,
  reviewPrompt: false,
  sessions: false,
  'telemetry.crashReports': false,
});

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

const rulesOf = (value: unknown): ClientPolicyRules => {
  const record = isRecord(value) ? value : {};
  return { minVersion: textOrNull(record.minVersion), latestVersion: textOrNull(record.latestVersion), storeUrl: textOrNull(record.storeUrl) };
};

/** Read any body into the documented shape; unknown or missing parts become their defaults. */
export function normalizeCapabilities(raw: unknown): CapabilitiesResponse {
  const record = isRecord(raw) ? raw : {};
  const capabilities: ServerCapabilities = {};
  if (isRecord(record.capabilities)) {
    for (const [key, value] of Object.entries(record.capabilities)) capabilities[key] = value === true;
  }
  const features: FeatureFlags = { ...FEATURE_DEFAULTS };
  if (isRecord(record.features)) {
    for (const [key, value] of Object.entries(record.features)) features[key] = value === true;
  }
  let client: ClientPolicyBlock | null = null;
  if (isRecord(record.client)) {
    const c = record.client;
    const platforms: Record<string, ClientPolicyRules> = {};
    if (isRecord(c.platforms)) {
      for (const [name, rules] of Object.entries(c.platforms)) platforms[name] = rulesOf(rules);
    }
    client = {
      ...rulesOf(c),
      platform: textOrNull(c.platform),
      version: textOrNull(c.version),
      build: textOrNull(c.build),
      updateRequired: c.updateRequired === true,
      updateAvailable: c.updateAvailable === true,
      message: textOrNull(c.message),
      platforms,
    };
  }
  return { capabilities, client, features };
}

/** A flag is on only when the server said exactly `true`. */
export function featureEnabled(features: FeatureFlags | null | undefined, name: string): boolean {
  return features?.[name] === true;
}

/**
 * Whether `POST /api/workouts/logs` honours `clientRequestId` on this
 * deployment (docs/api-contract.md, "`workoutLogIdempotency` capability").
 * True since v2-be-depth-1, but a client must not guess: the unkeyed route's
 * validator rejects the unknown field with `400 Unsupported workout field`.
 * False until the server has answered, so a save on the first frame is
 * unkeyed rather than refused. Named here so the capability's meaning lives
 * in one place and the session form does not grow its own query.
 */
export function useWorkoutLogIdempotency(): boolean {
  return useCapabilities().data?.capabilities.workoutLogIdempotency === true;
}

/**
 * The identity providers this deployment has credentials for
 * (`services/providerCapabilities.js`): `googleOAuth` is true once
 * `GOOGLE_CLIENT_ID` — or `CLIENT_ID_IOS` plus `WEB_CLIENT_ID` — is set,
 * `appleOAuth` once `APPLE_CLIENT_ID` is. Both are false on this server
 * today, so the one-tap buttons are not drawn at all: a "Continue with
 * Google" that answers 503 is worse than an email field.
 *
 * `any` is the server's own `oauth` capability (either provider), which is
 * what decides whether the divider above the buttons is drawn.
 */
export function useOAuthProviders(): { google: boolean; apple: boolean; any: boolean; isLoading: boolean } {
  const capabilities = useCapabilities();
  const caps = capabilities.data?.capabilities;
  const google = caps?.googleOAuth === true;
  const apple = caps?.appleOAuth === true;
  return { google, apple, any: google || apple, isLoading: capabilities.isLoading };
}

/**
 * `GET /food/barcode/:gtin` can answer on this deployment: the route is in
 * the build and at least one lookup tier (Open Food Facts or USDA) is
 * configured. False until the server has answered, so the scan button never
 * flashes in and out on a cold load.
 */
export function useFoodBarcode(): boolean {
  return useCapabilities().data?.capabilities.foodBarcode === true;
}

/**
 * Shared by the shell (to hide entry points for features this server does
 * not run) and by the feature pages (to explain why). One query key per
 * session state, so the sidebar and the Live page never disagree; the
 * signed-in variant evaluates flags for the member (allowlists, rollout
 * buckets), so the key changes with the session and refetches on sign-in.
 */
export function useCapabilities() {
  const signedIn = useAuth((s) => !!s.user);
  return useQuery({
    queryKey: ['capabilities', signedIn ? 'me' : 'public'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = signedIn ? await api.get('/capabilities/authenticated') : await api.get('/capabilities');
      return normalizeCapabilities(data);
    },
  });
}

/** One feature flag, false until the server has answered. */
export function useFeature(name: string): boolean {
  const capabilities = useCapabilities();
  return featureEnabled(capabilities.data?.features, name);
}

/**
 * Live video needs a media relay. Until the server has confirmed one exists,
 * the feature is not promoted anywhere: on servers without a relay this
 * avoids a flash of "Live" in the sidebar that then disappears, and on
 * servers with one the entry points appear once, a moment after first paint.
 */
export function liveVideoEnabled(caps: ServerCapabilities | undefined): boolean {
  return caps?.livestreamRelay === true;
}

/** Live is offered only when the `live` flag is on for this caller AND a relay is configured. */
export function liveAvailable(data: CapabilitiesResponse | undefined): boolean {
  return !!data && featureEnabled(data.features, 'live') && liveVideoEnabled(data.capabilities);
}

/** What the shell and the Live page read: the gate plus the query state the page renders. */
export function useLiveEnabled() {
  const capabilities = useCapabilities();
  return {
    enabled: liveAvailable(capabilities.data),
    isLoading: capabilities.isLoading,
    isError: capabilities.isError,
    error: capabilities.error,
    refetch: capabilities.refetch,
  };
}

/**
 * Together sessions have two switches. `capabilities.sessions` is the
 * server's kill switch (SESSIONS_ENABLED): off means every /api/sessions
 * write answers 503, so the landing page hides itself. `features.sessions`
 * is the rollout flag for this caller; an invite link is real whether or not
 * the feature is promoted, so the page only notes it. Unknown (the query is
 * still loading) counts as on, so nothing flashes an off state.
 */
export function useSessionsAccess() {
  const capabilities = useCapabilities();
  const data = capabilities.data;
  return {
    /** false only once the server said the switch is off. */
    enabled: data?.capabilities.sessions !== false,
    /** The server has answered and the rollout flag is off for this caller. */
    rolloutOff: !!data && !featureEnabled(data.features, 'sessions'),
    isLoading: capabilities.isLoading,
    isError: capabilities.isError,
  };
}

/**
 * A rollout flag with the query state a page gate needs. `useFeature` reads
 * false while the capabilities query is still pending, so a page that
 * redirected on it would bounce every cold load; the gate exposes `isPending`
 * so the page holds a skeleton until the server has answered, then hides the
 * surface (Navigate away) or renders it.
 */
export function useFeatureGate(name: string) {
  const capabilities = useCapabilities();
  return {
    enabled: featureEnabled(capabilities.data?.features, name),
    isPending: capabilities.isPending,
    isError: capabilities.isError,
    error: capabilities.error,
    refetch: capabilities.refetch,
  };
}
