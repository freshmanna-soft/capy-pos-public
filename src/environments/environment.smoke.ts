/**
 * Production-bundle smoke environment.
 *
 * `production: true` and every optimization/bundling setting the "production"
 * build config carries stay identical to `environment.prod.ts` — that's the
 * whole point of `playwright.smoke.config.ts`'s route-smoke suite: catching
 * prod-only bundle bugs (e.g. `process.env` referenced in a client bundle,
 * which threw "process is not defined" and broke every page) that a dev-server
 * e2e run can never see.
 *
 * The one deliberate difference is `allowSeededAdmin: true`. CI's smoke job
 * needs to sign in to exercise a protected route, and neither Cognito nor App
 * ID is live yet, so the only credential available is the seeded
 * admin@capy-pos.local account — which `environment.prod.ts` correctly refuses
 * to ever create. Gating that account on its own flag rather than on
 * `!environment.production` (see environment.ts) is what makes this file
 * possible without reopening the hole in the file that actually ships:
 * `environment.prod.ts` still sets `allowSeededAdmin: false`, so a real
 * deployed pilot never gains this account no matter what this file does.
 *
 * Keep the rest in step with `environment.prod.ts` by hand, as the staging and
 * test targets already are — this is a fork of that file's *values*, not an
 * import, so Angular's `fileReplacements` can swap it in as its own build
 * configuration.
 */
export const environment = {
  production: true,
  name: 'smoke',

  // The one flag this file exists to flip. See environment.ts.
  allowSeededAdmin: true,

  // API Configuration — identical to environment.prod.ts. The smoke suite
  // exercises the real production backends on purpose, same as `start:prod`
  // already did before this file existed.
  apiUrl: 'https://capy-pos-api.2e2tmn0h4vl7.us-south.codeengine.appdomain.cloud/api',
  apiTimeout: 30000,

  visionApiPath: '/vision/identify',
  visionApiUrl:
    'https://capy-vision-proxy.2e2tmn0h4vl7.us-south.codeengine.appdomain.cloud/vision/identify',

  clerkAgentApiPath: '/clerk/agent',
  clerkAgentApiUrl:
    'https://capy-clerk-agent-relay.2e2tmn0h4vl7.us-south.codeengine.appdomain.cloud/clerk/agent',

  // A distinct IndexedDB name, not `capy_pos_prod`: a smoke run is a browser
  // profile in a CI container that never touches a real device, but there is
  // no reason to share a name with the database a real pilot till would use.
  databaseName: 'capy_pos_smoke',
  enableOfflineMode: true,

  jwtExpiration: '8h',

  cognito: {
    enabled: false,
    region: 'us-east-1',
    staffUserPoolId: '',
    staffClientId: '',
    customerUserPoolId: '',
    allowedStoreDomain: '',
  },

  appId: {
    enabled: false,
    region: 'us-south',
    tenantId: 'ee0c0740-5252-48a4-9b7c-e2b60712256e',
    staffClientId: '6a92b580-1e10-4b09-ba3d-854f9fa774a5',
    customerClientId: '',
    relayUrl:
      'https://capy-appid-token-relay.2e2tmn0h4vl7.us-south.codeengine.appdomain.cloud/appid/token',
  },

  stripe: {
    publicKey: 'pk_test_51234567890',
    enabled: true,
  },

  features: {
    analytics: false,
    telemetry: false,
    auditLogging: true,
    offlineMode: true,
    aiVision: true,
    clerkAgent: true,
  },

  clerkVoice: {
    synthesis: true,
    recognition: true,
  },

  // Console logging on, unlike prod: a failing smoke run's console output is
  // read straight out of the Playwright report, not shipped anywhere.
  logging: {
    level: 'error',
    enableConsole: true,
    enableRemote: false,
  },

  cache: {
    ttl: 3600,
    maxSize: 1000,
  },

  rateLimit: {
    windowMs: 60000,
    maxRequests: 100,
  },

  circuitBreaker: {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000,
    monitoringPeriod: 120000,
  },

  retry: {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
  },

  // Never a real Sentry project — tagged 'smoke' so a misconfiguration could
  // never mislabel CI traffic as real production telemetry.
  sentry: {
    dsn: '',
    environment: 'smoke',
    tracesSampleRate: 0,
  },

  email: {
    enabled: false,
    from: 'smoke@capy-pos.local',
  },

  sms: {
    enabled: false,
  },

  backup: {
    enabled: false,
    interval: 43200000,
    retentionDays: 30,
  },

  security: {
    corsOrigin: 'https://capy-pos.com',
    corsCredentials: true,
    helmetEnabled: true,
  },

  // Telemetry off — no reason for a CI smoke run to export anything, real or not.
  telemetry: {
    otlp: {
      enabled: false,
      endpoint: 'http://localhost:4317',
      instanceId: '',
      apiKey: '',
    },
  },

  // Disabled: a third-party embed script has no reason to load in a CI smoke
  // run, and doing so would make this suite depend on that widget's own uptime.
  watsonxAssistant: {
    enabled: false,
    hostURL: 'https://jp-tok.watson-orchestrate.cloud.ibm.com',
    orchestrationID: '7f2f10ff1cde4ea9966b50822b66d0a3_6b4d0af6-bace-4662-980c-57995c7ab2ea',
    crn: 'crn:v1:bluemix:public:watsonx-orchestrate:jp-tok:a/7f2f10ff1cde4ea9966b50822b66d0a3:6b4d0af6-bace-4662-980c-57995c7ab2ea::',
    deploymentPlatform: 'ibmcloud',
    agentId: 'a7e2f127-2b6a-4446-8e7e-aa10b25c2ee0',
    agentEnvironmentId: '1571b423-085b-48f0-a29d-bf7309a5f8e1',
  },
};
