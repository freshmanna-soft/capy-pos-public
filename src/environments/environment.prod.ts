/**
 * Production Environment Configuration
 * This file is used for production builds
 */
export const environment = {
  production: true,
  name: 'production',

  // API Configuration
  apiUrl: 'https://fqjj2r15m7.execute-api.us-east-1.amazonaws.com/api',
  apiTimeout: 30000,

  // Database
  databaseName: 'capy_pos_prod',
  enableOfflineMode: true,

  // Authentication
  jwtExpiration: '8h',

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

  // Payment Gateway (Stripe Live Mode)
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
  },

  // Logging
  logging: {
    level: 'error',
    enableConsole: false,
    enableRemote: true,
  },

  // Cache
  cache: {
    ttl: 3600, // 1 hour
    maxSize: 1000,
  },

  // Rate Limiting
  rateLimit: {
    windowMs: 60000, // 1 minute
    maxRequests: 100,
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
    environment: 'production',
    tracesSampleRate: 0.1,
  },

  // Email
  email: {
    enabled: true,
    from: 'noreply@capy-pos.com',
  },

  // SMS
  sms: {
    enabled: true,
  },

  // Backup
  backup: {
    enabled: true,
    interval: 43200000, // 12 hours
    retentionDays: 30,
  },

  // Security
  security: {
    corsOrigin: 'https://capy-pos.com',
    corsCredentials: true,
    helmetEnabled: true,
  },

  // OpenTelemetry — Grafana Cloud.
  // NOTE: this is a CLIENT bundle — `process.env` does not exist in the browser
  // (Angular's esbuild never substitutes it), so referencing it here threw
  // "process is not defined" at bootstrap and broke every page in prod. Secrets
  // must not be baked into a client bundle regardless. Credentials are left empty;
  // when absent the OTLP exporter exports unauthenticated (dropped) instead of
  // crashing. Inject real creds via a runtime config fetch if telemetry is revived.
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
