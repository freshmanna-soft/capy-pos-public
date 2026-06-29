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

  // Database
  databaseName: 'capy_pos_dev',
  enableOfflineMode: true,

  // Authentication
  jwtExpiration: '24h',

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
      apiKey: '',
    },
  },
};

// Made with Bob
