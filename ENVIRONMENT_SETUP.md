# Environment Configuration Guide

## Overview

Capy-POS uses environment-specific configuration files to manage settings across different deployment environments. This guide explains how to set up and use these configurations.

## Environment Files

### Available Environments

1. **Development** (`.env.development`) - Local development
2. **Test** (`.env.test`) - Automated testing
3. **Staging** (`.env.staging`) - Pre-production testing
4. **Production** (`.env.production`) - Live production

### File Structure

```
capy-pos/
├── .env.example              # Template with all options
├── .env.development          # Development settings
├── .env.staging              # Staging settings
├── .env.production           # Production settings
├── .env.test                 # Test settings
├── .env.local                # Local overrides (gitignored)
└── src/environments/
    ├── environment.ts        # Development (default)
    ├── environment.prod.ts   # Production
    ├── environment.staging.ts # Staging
    └── environment.test.ts   # Test
```

## Setup Instructions

### 1. Initial Setup

Copy the example file to create your local configuration:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your local settings. This file is gitignored and won't be committed.

### 2. Development Setup

The development environment is configured by default. Just run:

```bash
npm start
# or
ng serve
```

This uses `src/environments/environment.ts` and `.env.development`.

### 3. Building for Different Environments

#### Development Build
```bash
ng build --configuration=development
```

#### Staging Build
```bash
ng build --configuration=staging
```

#### Production Build
```bash
ng build --configuration=production
# or simply
ng build
```

#### Test Build
```bash
ng build --configuration=test
```

### 4. Serving Different Environments

```bash
# Development (default)
ng serve

# Staging
ng serve --configuration=staging

# Production
ng serve --configuration=production
```

## Configuration Options

### Application Settings

- `NODE_ENV` - Environment name (development, staging, production, test)
- `PORT` - Application port (default: 4200)

### API Configuration

- `API_BASE_URL` - Backend API URL
- `API_TIMEOUT` - Request timeout in milliseconds

### Database

- `DATABASE_URL` - Database connection string
- `DATABASE_POOL_MIN` - Minimum connection pool size
- `DATABASE_POOL_MAX` - Maximum connection pool size

### Authentication

- `AUTH_SECRET` - Secret key for authentication
- `JWT_SECRET` - JWT signing secret
- `JWT_EXPIRATION` - Token expiration time

### Payment Gateway (Stripe)

- `STRIPE_PUBLIC_KEY` - Stripe publishable key
- `STRIPE_SECRET_KEY` - Stripe secret key
- `STRIPE_WEBHOOK_SECRET` - Webhook signing secret

### Feature Flags

- `ENABLE_OFFLINE_MODE` - Enable offline functionality
- `ENABLE_ANALYTICS` - Enable analytics tracking
- `ENABLE_TELEMETRY` - Enable telemetry
- `ENABLE_AUDIT_LOGGING` - Enable audit logs

### Monitoring

- `SENTRY_DSN` - Sentry error tracking DSN
- `SENTRY_ENVIRONMENT` - Environment name for Sentry
- `SENTRY_TRACES_SAMPLE_RATE` - Sampling rate for traces

### Circuit Breaker

- `CIRCUIT_BREAKER_FAILURE_THRESHOLD` - Failures before opening
- `CIRCUIT_BREAKER_SUCCESS_THRESHOLD` - Successes to close
- `CIRCUIT_BREAKER_TIMEOUT` - Timeout before half-open
- `CIRCUIT_BREAKER_MONITORING_PERIOD` - Failure counting window

### Retry Configuration

- `RETRY_MAX_ATTEMPTS` - Maximum retry attempts
- `RETRY_INITIAL_DELAY` - Initial delay in ms
- `RETRY_MAX_DELAY` - Maximum delay in ms
- `RETRY_BACKOFF_MULTIPLIER` - Backoff multiplier

## Security Best Practices

### 1. Never Commit Secrets

- `.env.local` is gitignored - use it for local secrets
- Never commit API keys, passwords, or tokens
- Use environment variables in CI/CD pipelines

### 2. Use Different Keys Per Environment

- Development: Use test/sandbox keys
- Staging: Use separate staging keys
- Production: Use production keys with restricted access

### 3. Rotate Secrets Regularly

- Change secrets periodically
- Rotate immediately if compromised
- Use secret management tools (IBM Secrets Manager, HashiCorp Vault)

## IBM Cloud Deployment

### Setting Environment Variables in Code Engine

```bash
# Set environment variables
ibmcloud ce application update capy-pos \
  --env-from-secret capy-pos-secrets \
  --env NODE_ENV=production

# Create secret
ibmcloud ce secret create capy-pos-secrets \
  --from-env-file .env.production
```

### Using IBM Secrets Manager

```bash
# Store secrets in IBM Secrets Manager
ibmcloud secrets-manager secret-create \
  --secret-type=arbitrary \
  --name=capy-pos-stripe-key \
  --secret-data='{"api_key":"sk_live_..."}'
```

## Accessing Configuration in Code

### TypeScript/Angular

```typescript
import { environment } from './environments/environment';

// Access configuration
const apiUrl = environment.apiUrl;
const isProduction = environment.production;

// Feature flags
if (environment.features.analytics) {
  // Initialize analytics
}
```

### Service Example

```typescript
@Injectable({ providedIn: 'root' })
export class ApiService {
  private apiUrl = environment.apiUrl;
  private timeout = environment.apiTimeout;

  constructor(private http: HttpClient) {}

  getData() {
    return this.http.get(`${this.apiUrl}/data`, {
      timeout: this.timeout
    });
  }
}
```

## Troubleshooting

### Environment Not Loading

1. Check file replacements in `angular.json`
2. Verify environment file exists
3. Rebuild the application

### Wrong Configuration Active

1. Check `--configuration` flag
2. Verify `defaultConfiguration` in `angular.json`
3. Clear build cache: `rm -rf .angular/cache`

### Missing Environment Variables

1. Check `.env.example` for required variables
2. Ensure all required variables are set
3. Verify environment file is being loaded

## Additional Resources

- [Angular Environments](https://angular.io/guide/build#configuring-application-environments)
- [IBM Cloud Code Engine](https://cloud.ibm.com/docs/codeengine)
- [Environment Variables Best Practices](https://12factor.net/config)

## Support

For issues or questions:
- Check `PROJECT_STATUS.md` for project status
- Review `ARCHITECTURE.md` for system design
- See `INFRASTRUCTURE_GUIDE.md` for infrastructure details