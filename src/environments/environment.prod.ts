/**
 * Production Environment Configuration
 * This file is used for production builds
 */
export const environment = {
  production: true,
  name: 'production',

  // API Configuration
  apiUrl: 'https://api.capy-pos.com/api',
  apiTimeout: 30000,

  // Database
  databaseName: 'capy_pos_prod',
  enableOfflineMode: true,

  // Authentication
  jwtExpiration: '8h',

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
};
