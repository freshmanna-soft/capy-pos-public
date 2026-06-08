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
  
  // Database (in-memory for tests)
  databaseName: 'capy_pos_test',
  enableOfflineMode: true,
  
  // Authentication
  jwtExpiration: '1h',
  
  // Payment Gateway (Mock)
  stripe: {
    publicKey: 'pk_test_mock',
    enabled: false
  },
  
  // Feature Flags
  features: {
    analytics: false,
    telemetry: false,
    auditLogging: false,
    offlineMode: true,
    aiVision: false
  },
  
  // Logging
  logging: {
    level: 'error',
    enableConsole: false,
    enableRemote: false
  },
  
  // Cache
  cache: {
    ttl: 60, // 1 minute
    maxSize: 10
  },
  
  // Rate Limiting (disabled for tests)
  rateLimit: {
    windowMs: 60000,
    maxRequests: 10000
  },
  
  // Circuit Breaker (fast timeouts for tests)
  circuitBreaker: {
    failureThreshold: 3,
    successThreshold: 1,
    timeout: 1000,
    monitoringPeriod: 5000
  },
  
  // Retry (minimal for tests)
  retry: {
    maxAttempts: 2,
    initialDelay: 100,
    maxDelay: 1000,
    backoffMultiplier: 2
  },
  
  // Monitoring (disabled)
  sentry: {
    dsn: '',
    environment: 'test',
    tracesSampleRate: 0
  },
  
  // Email (disabled)
  email: {
    enabled: false,
    from: 'test@capy-pos.test'
  },
  
  // SMS (disabled)
  sms: {
    enabled: false
  },
  
  // Backup (disabled)
  backup: {
    enabled: false,
    interval: 86400000,
    retentionDays: 1
  }
};

// Made with Bob
