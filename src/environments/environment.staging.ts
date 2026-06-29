/**
 * Staging Environment Configuration
 * Pre-production testing environment
 */
export const environment = {
  production: false,
  name: 'staging',

  // API Configuration
  apiUrl: 'https://api-staging.capy-pos.com/api',
  apiTimeout: 30000,

  // Database
  databaseName: 'capy_pos_staging',
  enableOfflineMode: true,

  // Authentication
  jwtExpiration: '12h',

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

  // OpenTelemetry — Grafana Cloud
  telemetry: {
    otlp: {
      enabled: true,
      endpoint: 'https://otlp-gateway-prod-us-east-3.grafana.net/otlp',
      apiKey: process.env['GRAFANA_OTLP_API_KEY'] || '',
    },
  },
};

// Made with Bob
