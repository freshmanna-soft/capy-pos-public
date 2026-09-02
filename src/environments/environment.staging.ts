/**
 * Staging Environment Configuration
 * Pre-production testing environment
 */
export const environment = {
  production: false,
  name: 'staging',

  // See environment.ts — decoupled from `production` on purpose.
  allowSeededAdmin: true,

  // API Configuration
  apiUrl: 'https://api-staging.capy-pos.com/api',
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

  // Database
  databaseName: 'capy_pos_staging',
  enableOfflineMode: true,

  // Authentication
  jwtExpiration: '12h',

  // AWS Cognito (Story #140) — populate from the Terraform outputs when the staff
  // pool is stood up. `enabled: false` until then keeps the local adapter in play.
  cognito: {
    enabled: false,
    region: 'us-east-1',
    staffUserPoolId: '', // Set via environment / TF output
    staffClientId: '', // Set via environment / TF output
    customerUserPoolId: '',
    allowedStoreDomain: '',
  },

  // IBM Cloud App ID — see environment.ts for the full rationale.
  appId: {
    enabled: false,
    region: 'us-south',
    tenantId: 'ee0c0740-5252-48a4-9b7c-e2b60712256e',
    staffClientId: '6a92b580-1e10-4b09-ba3d-854f9fa774a5',
    customerClientId: '',
    relayUrl: '', // Set once infra/appid-token-relay is deployed for staging
  },

  // Payment Gateway (Stripe Test Mode)
  stripe: {
    publicKey: '', // Set via environment variable
    enabled: true,
  },

  // Feature Flags
  features: {
    analytics: true,
    telemetry: true,
    auditLogging: true,
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
    synthesis: true,
    recognition: true,
  },

  // Logging
  logging: {
    level: 'debug',
    enableConsole: true,
    enableRemote: true,
  },

  // Cache
  cache: {
    ttl: 1800, // 30 minutes
    maxSize: 500,
  },

  // Rate Limiting
  rateLimit: {
    windowMs: 60000, // 1 minute
    maxRequests: 200,
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
    dsn: '', // Set via environment variable
    environment: 'staging',
    tracesSampleRate: 0.5,
  },

  // Email
  email: {
    enabled: true,
    from: 'staging@capy-pos.com',
  },

  // SMS
  sms: {
    enabled: true,
  },

  // Backup
  backup: {
    enabled: true,
    interval: 86400000, // 24 hours
    retentionDays: 14,
  },

  // Security
  security: {
    corsOrigin: 'https://staging.capy-pos.com',
    corsCredentials: true,
    helmetEnabled: true,
  },

  // OpenTelemetry — Grafana Cloud.
  // `process.env` does not exist in the browser (client bundle) — referencing it
  // crashed the app at bootstrap. Leave creds empty; the exporter degrades to
  // unauthenticated export rather than throwing. See environment.prod.ts.
  telemetry: {
    otlp: {
      enabled: true,
      endpoint: 'https://otlp-gateway-prod-us-east-3.grafana.net/otlp',
      instanceId: '',
      apiKey: '',
    },
  },

  // WatsonX Orchestrate — embedded AI assistant chat widget. Client-side embed
  // identifiers (not secrets). Relocated out of the component so each build
  // target can point at its own orchestration/agent.
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
