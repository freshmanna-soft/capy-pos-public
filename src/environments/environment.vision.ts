/**
 * Local Development Environment — with real recognition switched on.
 *
 * A copy of `environment.ts` with exactly two values changed:
 *
 *   features.aiVision  false → true                              (use Claude, not the mock)
 *   visionApiUrl       ''    → http://localhost:8788/vision/…    (the local proxy)
 *
 * It is a separate build target rather than a flag flipped in `environment.ts`
 * because turning live vision on has costs the default dev build should not
 * carry: every settled frame is a paid model call, the clerk asks for camera
 * consent before it will start, and the e2e suite runs against `ng serve` with no
 * proxy listening. Opting in per run keeps all three out of the way until asked
 * for.
 *
 *   npm run vision:proxy    # terminal one — holds the model key
 *   npm run start:vision    # terminal two — serves this configuration
 *
 * Port 8788 rather than the proxy's own 8787 default: on this machine 8787 is
 * already taken by another local service, and the proxy reads PORT.
 *
 * Keep the rest in step with `environment.ts` by hand, as the prod, staging and
 * test targets already are.
 */
export const environment = {
  production: false,
  name: 'development-vision',

  // API Configuration
  apiUrl: 'https://fqjj2r15m7.execute-api.us-east-1.amazonaws.com/api',
  apiTimeout: 30000,

  // AI clerk vision proxy, relative to apiUrl. The model API key lives in
  // this endpoint, never in the browser bundle — see infra/vision-proxy.
  visionApiPath: '/vision/identify',

  // Absolute: recognition goes to the local proxy while everything else — the
  // catalogue, transactions, the sync worker — keeps talking to the real gateway.
  visionApiUrl: 'http://localhost:8788/vision/identify',

  // AI clerk agent relay, relative to apiUrl. The model API key lives behind
  // this endpoint, never in the browser bundle, exactly as the vision proxy does.
  clerkAgentApiPath: '/clerk/agent',

  // Absolute override for the agent endpoint. Empty means "append
  // clerkAgentApiPath to apiUrl"; the override wins when it is set, so a local
  // relay can be pointed at without repointing `apiUrl` at a service that only
  // answers /clerk/agent.
  clerkAgentApiUrl: '',

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

  // Payment Gateway (Stripe Test Mode)
  stripe: {
    publicKey: 'pk_test_51234567890',
    enabled: true,
  },

  // Feature Flags
  features: {
    analytics: false,
    telemetry: false,
    auditLogging: true,
    offlineMode: true,
    aiVision: true,
    // The agentic clerk tier — the phrases the keyword parser cannot name. Its own
    // flag, not aiVision: that one governs paying the model to *look*, and the two
    // switch on independently.
    clerkAgent: false,
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
