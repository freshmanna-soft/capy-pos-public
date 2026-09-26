/**
 * Development Environment Configuration
 * This file is used during local development
 */
export const environment = {
  production: false,
  name: 'development',

  /**
   * Geofencing — dev/test overrides.
   *
   * `mockPosition`: when set, GeofencingService returns this lat/lng instead
   *   of calling navigator.geolocation. Set to a point inside your test polygon
   *   to test the "inside" path, or outside it for "outside".
   *   Leave null to use the real browser Geolocation API (default for staging
   *   and production; will be null there).
   *
   * Example — fake-GPS to a coordinate inside a drawn polygon:
   *   mockPosition: { lat: 40.7128, lng: -74.0060 }
   */
  geofencing: {
    mockPosition: null as { lat: number; lng: number } | null,
  },

  // Gates *creating* the seeded admin@capy-pos.local bootstrap account in
  // dexie-database.service.ts. Deliberately its own flag rather than
  // `!production`: a build config can be "production" in every optimization/
  // bundling sense (see environment.smoke.ts) without being the real deployed
  // pilot, and only the real deployed pilot may never gain this account.
  allowSeededAdmin: true,

  // API Configuration
  //
  // The open follow-up #224 left behind: local dev now points at a *locally
  // run* infra/pos-api, not the retired terraform/aws-demo host (#206, DNS no
  // longer resolves) and deliberately not the real production IBM pos-api —
  // pointing a dev till at that would mean every local sync writes real
  // products/transactions into the actual pilot's live Cloudant store.
  //
  //   SESSION_JWT_SECRET=capy-pos-local-jwt-secret-change-in-production \
  //   POS_API_STORE=memory PORT=8790 npm start   # in infra/pos-api, another terminal
  //
  // In-memory store: data resets on every restart, by design — this is a
  // throwaway backend for local dev, not somewhere to keep anything real.
  apiUrl: 'http://localhost:8790/api',
  apiTimeout: 30000,

  // AI clerk vision proxy, relative to apiUrl. The model API key lives in
  // this endpoint, never in the browser bundle — see infra/vision-proxy.
  visionApiPath: '/vision/identify',

  // Absolute override for the vision endpoint. Empty means "append visionApiPath
  // to apiUrl", which is right in production where both are the same gateway.
  //
  // It exists so real recognition can be switched on locally against
  // `npm start` in infra/vision-proxy without repointing `apiUrl` — doing that
  // would send products, transactions and the whole sync worker at a service
  // that only answers /vision/identify, and the till would look broken for
  // reasons that have nothing to do with vision.
  visionApiUrl: '',

  // AI clerk agent relay, relative to apiUrl. The model API key lives behind
  // this endpoint, never in the browser bundle, exactly as the vision proxy does.
  clerkAgentApiPath: '/clerk/agent',

  // Absolute override for the agent endpoint. Empty means "append
  // clerkAgentApiPath to apiUrl"; the override wins when it is set, so a local
  // relay can be pointed at without repointing `apiUrl` at a service that only
  // answers /clerk/agent.
  clerkAgentApiUrl: '',

  // Product image upload path, appended to apiUrl: POST `${apiUrl}${imageApiPath}/${productId}/image`
  imageApiPath: '/products',

  // Database
  databaseName: 'capy_pos_dev',
  enableOfflineMode: true,

  // Authentication
  jwtExpiration: '24h',

  // AWS Cognito (Story #140) — empty in dev; the local credential adapter is the
  // default gateway. Fill these in (or swap the provider) to exercise the Cognito
  // adapter against a real staff user pool. `enabled: false` keeps the swap opt-in.
  cognito: {
    enabled: false,
    region: 'us-east-1',
    staffUserPoolId: '',
    staffClientId: '',
    // A customer-pool token must NEVER satisfy the staff authorizer; the staff
    // issuer/audience binding enforces this. Kept here for documentation/tooling.
    customerUserPoolId: '',
    // When set, the adapter rejects a token whose `custom:store_domain` claim does
    // not match the domain the SPA is served from. Empty disables the check.
    allowedStoreDomain: '',
  },

  // IBM Cloud App ID — the IBM-hosted swap for Cognito (spike: reconcile auth
  // provider, 2026-09-01). Same AuthGateway seam, same enabled-flag pattern.
  // `relayUrl` points at `infra/appid-token-relay` (not yet built) — App ID's
  // token endpoint requires a client secret via HTTP Basic auth, which cannot
  // safely live in a browser bundle the way Cognito's public client can skip
  // it, so login goes through a small server-side relay instead of App ID
  // directly. Real tenantId/staffClientId below — not secrets, same as
  // Cognito's pool/client ids are committed in plaintext; only the client
  // *secret* is sensitive, and that lives in the relay's Code Engine secret,
  // never here.
  // IBM Cloud App ID — opt-in. Set `enabled: true` only when the relay is
  // running locally (`npm run start:relay` in a second terminal). Leaving it
  // false keeps `ng serve` working without the relay, which is the normal dev
  // workflow. E2E tests (Playwright) bypass auth entirely via sessionStorage
  // injection (see tests/e2e/helpers/auth.ts) so they don't need the relay
  // regardless of this flag.
  appId: {
    enabled: false,
    region: 'us-south',
    tenantId: 'ee0c0740-5252-48a4-9b7c-e2b60712256e',
    staffClientId: '6a92b580-1e10-4b09-ba3d-854f9fa774a5',
    // The customer half of the same tenant (epic #261): a second App ID
    // *application*, not a second pool. Empty until that registration exists —
    // `customerClientId` is what a customer token's `aud` will be, which is
    // exactly what keeps it from satisfying the staff gateway's audience check.
    customerClientId: '',
    relayUrl: 'http://localhost:8792/appid/token',
    // The relay's sibling customer route. Separately deployable from the staff
    // one: it 502s until APPID_CUSTOMER_CLIENT_ID/_SECRET are set on the relay.
    customerRelayUrl: 'http://localhost:8792/appid/customer/token',
  },

  // Payment Gateway (Stripe Test Mode)
  stripe: {
    publicKey: 'pk_test_51234567890',
    enabled: true,
  },

  // MercadoPago — enabled when the till runs in kiosk or operator mode. The
  // public key is not a secret (same as Stripe's publishable key): it identifies
  // the merchant account but grants no write access. The *access token* (secret)
  // must live server-side only and is never compiled into this bundle.
  // `preferenceApiUrl` points at the operator backend that creates MP preferences
  // using the server-side access token and returns only the preference id.
  mercadopago: {
    enabled: true,
    publicKey: 'APP_USR-6304b4d3-513f-47eb-99bb-91a86ad5ddb4', // replace with real TEST key
    preferenceApiUrl: 'http://localhost:8790/api/mercadopago/preference',
  },

  // PayPal — disabled in dev; the adapter is opt-in per build target.
  // clientId is the PayPal app's client ID (not a secret). The access token
  // used to capture orders lives server-side in preferenceApiUrl only.
  paypal: {
    enabled: false,
    clientId: '', // replace with sandbox client ID for local testing
    environment: 'sandbox' as const,
    preferenceApiUrl: 'http://localhost:8790/api/paypal/order',
  },

  // Feature Flags
  features: {
    analytics: false,
    telemetry: false,
    auditLogging: true,
    offlineMode: true,
    aiVision: false,
    // The agentic clerk tier — the phrases the keyword parser cannot name. Its own
    // flag, not aiVision: that one governs paying the model to *look*, and the two
    // switch on independently.
    clerkAgent: false,
    // Kiosk self-checkout mode — when enabled the default route is /kiosk.
    kiosk: false,
  },

  // AI clerk voice. Browser Web Speech APIs — no keys, no cost, but
  // Chromium/Safari only and recognition needs a secure context.
  clerkVoice: {
    synthesis: true,
    recognition: true,
  },

  // Logging
  logging: {
    level: 'debug',
    enableConsole: true,
    enableRemote: false,
  },

  // Cache
  cache: {
    ttl: 300, // 5 minutes
    maxSize: 50,
  },

  // Rate Limiting
  rateLimit: {
    windowMs: 60000, // 1 minute
    maxRequests: 1000,
  },

  // Circuit Breaker
  circuitBreaker: {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000,
    monitoringPeriod: 120000,
  },

  // Retry
  retry: {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
  },

  // Monitoring
  sentry: {
    dsn: '',
    environment: 'development',
    tracesSampleRate: 0,
  },

  // Email (disabled in dev)
  email: {
    enabled: false,
    from: 'dev@capy-pos.local',
  },

  // SMS (disabled in dev)
  sms: {
    enabled: false,
  },

  // Backup
  backup: {
    enabled: false,
    interval: 86400000, // 24 hours
    retentionDays: 7,
  },

  // OpenTelemetry
  telemetry: {
    otlp: {
      enabled: false,
      endpoint: 'http://localhost:4317',
      instanceId: '',
      apiKey: '',
    },
  },

  // WatsonX Orchestrate — embedded AI assistant chat widget. These are
  // client-side embed identifiers (not secrets), same as any browser chat
  // widget. Relocated out of the component so each build target can point at
  // its own orchestration/agent, and so the widget can be disabled per-env.
  watsonxAssistant: {
    enabled: true,
    hostURL: 'https://jp-tok.watson-orchestrate.cloud.ibm.com',
    orchestrationID: '7f2f10ff1cde4ea9966b50822b66d0a3_6b4d0af6-bace-4662-980c-57995c7ab2ea',
    crn: 'crn:v1:bluemix:public:watsonx-orchestrate:jp-tok:a/7f2f10ff1cde4ea9966b50822b66d0a3:6b4d0af6-bace-4662-980c-57995c7ab2ea::',
    deploymentPlatform: 'ibmcloud',
    agentId: 'a7e2f127-2b6a-4446-8e7e-aa10b25c2ee0',
    agentEnvironmentId: '1571b423-085b-48f0-a29d-bf7309a5f8e1',
  },
};

// Made with Bob
