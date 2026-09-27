/**
 * GitHub Pages Environment Configuration
 *
 * Served from https://freshmanna-soft.github.io/capy-pos-public/
 *
 * Identical to production in every way except MercadoPago:
 *   - publicKey        → MercadoPago TEST public key (injected by CI from
 *                        the MERCADOPAGO_PUBLIC_KEY_TEST GitHub secret)
 *   - preferenceApiUrl → /preference/test route on the same IBM Cloud
 *                        pos-api, which uses MERCADOPAGO_ACCESS_TOKEN_TEST
 *                        instead of the production token.
 *
 * This keeps the real production token out of GitHub Pages payments while
 * still using the single deployed backend — no second pos-api needed.
 */
export const environment = {
  production: true,
  name: 'github-pages',

  allowSeededAdmin: false,
  geofencing: { mockPosition: null as { lat: number; lng: number } | null },

  apiUrl: 'https://capy-pos-api.2e2tmn0h4vl7.us-south.codeengine.appdomain.cloud/api',
  apiTimeout: 30000,

  visionApiPath: '/vision/identify',
  visionApiUrl:
    'https://capy-vision-proxy.2e2tmn0h4vl7.us-south.codeengine.appdomain.cloud/vision/identify',

  clerkAgentApiPath: '/clerk/agent',
  clerkAgentApiUrl:
    'https://capy-clerk-agent-relay.2e2tmn0h4vl7.us-south.codeengine.appdomain.cloud/clerk/agent',

  // Product image upload path, appended to apiUrl: POST `${apiUrl}${imageApiPath}/${productId}/image`
  imageApiPath: '/products',

  databaseName: 'capy_pos_prod',
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
    enabled: true,
    region: 'us-south',
    tenantId: 'ee0c0740-5252-48a4-9b7c-e2b60712256e',
    staffClientId: '6a92b580-1e10-4b09-ba3d-854f9fa774a5',
    customerClientId: '',
    relayUrl:
      'https://capy-appid-token-relay.2e2tmn0h4vl7.us-south.codeengine.appdomain.cloud/appid/token',
  },

  stripe: {
    publicKey: '',
    enabled: true,
  },

  // MercadoPago — GitHub Pages uses the TEST public key and the /preference/test
  // route on the shared IBM Cloud pos-api. That route reads
  // MERCADOPAGO_ACCESS_TOKEN_TEST from the Code Engine secret, so no real money
  // moves through GitHub Pages payments. Both values are injected by CI from
  // GitHub secrets (MERCADOPAGO_PUBLIC_KEY_TEST); neither is committed here.
  mercadopago: {
    enabled: true,
    publicKey: '', // Set via CI secret: MERCADOPAGO_PUBLIC_KEY_TEST
    preferenceApiUrl:
      'https://capy-pos-api.2e2tmn0h4vl7.us-south.codeengine.appdomain.cloud/api/mercadopago/preference/test',
  },

  paypal: {
    enabled: false,
    clientId: '',
    environment: 'production' as const,
    preferenceApiUrl:
      'https://capy-pos-api.2e2tmn0h4vl7.us-south.codeengine.appdomain.cloud/api/paypal/order',
  },

  features: {
    analytics: true,
    telemetry: true,
    auditLogging: true,
    offlineMode: true,
    aiVision: true,
    clerkAgent: true,
    kiosk: true,
  },

  clerkVoice: {
    synthesis: true,
    recognition: true,
  },

  logging: {
    level: 'error',
    enableConsole: false,
    enableRemote: true,
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

  sentry: {
    dsn: '',
    environment: 'github-pages',
    tracesSampleRate: 0.1,
  },

  email: {
    enabled: true,
    from: 'noreply@capy-pos.com',
  },

  sms: {
    enabled: true,
  },

  backup: {
    enabled: true,
    interval: 43200000,
    retentionDays: 30,
  },

  security: {
    corsOrigin: 'https://freshmanna-soft.github.io',
    corsCredentials: true,
    helmetEnabled: true,
  },

  telemetry: {
    otlp: {
      enabled: true,
      endpoint: 'https://otlp-gateway-prod-us-east-3.grafana.net/otlp',
      instanceId: '',
      apiKey: '',
    },
  },

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
