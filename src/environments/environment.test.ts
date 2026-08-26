/**
 * Test Environment Configuration
 * Used for automated testing (unit, integration, E2E)
 */
export const environment = {
  production: false,
  name: 'test',

  // API Configuration
  apiUrl: 'http://localhost:4200/api',
  apiTimeout: 10000,

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

  // Database (in-memory for tests)
  databaseName: 'capy_pos_test',
  enableOfflineMode: true,

  // Authentication
  jwtExpiration: '1h',

  // AWS Cognito (Story #140) — deterministic test defaults. Specs override the
  // config via the COGNITO_CONFIG token, so these are placeholders only.
  cognito: {
    enabled: false,
    region: 'us-east-1',
    staffUserPoolId: 'us-east-1_testpool',
    staffClientId: 'test-client-id',
    customerUserPoolId: 'us-east-1_custpool',
    allowedStoreDomain: '',
  },

  // Payment Gateway (Mock)
  stripe: {
    publicKey: 'pk_test_mock',
    enabled: false,
  },

  // Feature Flags
  features: {
    analytics: false,
    telemetry: false,
    auditLogging: false,
    offlineMode: true,
    aiVision: false,
    // The agentic clerk tier — the phrases the keyword parser cannot name. Its own
    // flag, not aiVision: that one governs paying the model to *look*, and the two
    // switch on independently.
    clerkAgent: false,
  },

  // AI clerk voice. Browser Web Speech APIs — no keys, no cost, but
  // Chromium/Safari only and recognition needs a secure context.
  clerkVoice: {
    synthesis: false,
    recognition: false,
  },

  // Logging
  logging: {
    level: 'error',
    enableConsole: false,
    enableRemote: false,
  },

  // Cache
  cache: {
    ttl: 60, // 1 minute
    maxSize: 10,
  },

  // Rate Limiting (disabled for tests)
  rateLimit: {
    windowMs: 60000,
    maxRequests: 10000,
  },

  // Circuit Breaker (fast timeouts for tests)
  circuitBreaker: {
    failureThreshold: 3,
    successThreshold: 1,
    timeout: 1000,
    monitoringPeriod: 5000,
  },

  // Retry (minimal for tests)
  retry: {
    maxAttempts: 2,
    initialDelay: 100,
    maxDelay: 1000,
    backoffMultiplier: 2,
  },

  // Monitoring (disabled)
  sentry: {
    dsn: '',
    environment: 'test',
    tracesSampleRate: 0,
  },

  // Email (disabled)
  email: {
    enabled: false,
    from: 'test@capy-pos.test',
  },

  // SMS (disabled)
  sms: {
    enabled: false,
  },

  // Backup (disabled)
  backup: {
    enabled: false,
    interval: 86400000,
    retentionDays: 1,
  },

  // WatsonX Orchestrate — disabled under test so no external loader script is
  // injected into headless/CI builds.
  watsonxAssistant: {
    enabled: false,
    hostURL: '',
    orchestrationID: '',
    crn: '',
    deploymentPlatform: 'ibmcloud',
    agentId: '',
    agentEnvironmentId: '',
  },
};

// Made with Bob
