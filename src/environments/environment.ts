/**
 * Development Environment Configuration
 * This file is used during local development
 */
export const environment = {
  production: false,
  name: 'development',

  // API Configuration
  apiUrl: 'https://fqjj2r15m7.execute-api.us-east-1.amazonaws.com/api',
  apiTimeout: 30000,

  // Shared service token for the sync backend (issue #206). Every route on
  // `terraform/aws-demo` except `GET /api/health` requires
  // `Authorization: Bearer <token>`; the sync worker sends it when this is set and
  // sends no header at all when it is blank.
  //
  // Empty here on purpose, and it must stay that way: this file is compiled into
  // the browser bundle, so anything written here is readable by every visitor and
  // the token would be public with extra steps — the same reason the OTLP
  // credentials below are empty. Supply it at runtime (a config fetch, or a build
  // that injects it for a trusted deployment) and pass it to
  // `SyncService.start({ serviceToken })`. Server-to-server callers — seed
  // scripts, the MCP server, curl — pass it directly and work today.
  //
  // While it is empty, sync 401s against a restood stack and the till runs on Dexie
  // alone. That is the deliberate #206 trade: an API nobody can write to
  // anonymously beats a working sync anyone on the internet can write to. Real
  // per-user auth (Cognito, #200) is what removes the trade.
  apiServiceToken: '',

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
