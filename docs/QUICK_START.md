# Capy-POS Quick Start Guide

## 🚀 Getting Started

### Prerequisites
- Node.js 20+
- npm 11+
- IBM Cloud account
- Terraform 1.5+
- Docker

### Installation

```bash
# Clone repository
git clone git@github.ibm.com:your-org/capy-pos.git
cd capy-pos

# Install dependencies
npm install

# Install testing tools
npm install -D @playwright/test @cucumber/cucumber playwright
npm install -D @storybook/angular @storybook/addon-essentials

# Install UI frameworks
npm install @angular/material @angular/cdk
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init

# Install SQLite
npm install better-sqlite3 @types/better-sqlite3
```

### Development

```bash
# Start development server
npm start

# Run tests
npm run test              # Unit tests
npm run test:e2e          # E2E tests with Playwright
npm run test:cucumber     # BDD tests

# Run Storybook
npm run storybook

# Build for production
npm run build
```

### Project Structure

```
capy-pos/
├── src/app/
│   ├── core/                    # Core architecture
│   │   ├── domain/              # Business entities
│   │   ├── application/         # Use cases
│   │   └── infrastructure/      # Repositories
│   ├── agents/                  # Microservices
│   │   ├── inventory/
│   │   ├── sales/
│   │   ├── payment/
│   │   ├── analytics/
│   │   ├── customer/
│   │   └── integration/
│   └── shared/ui/               # Micro components
│       ├── atoms/
│       ├── molecules/
│       └── organisms/
├── tests/e2e/                   # E2E tests
├── terraform/                   # Infrastructure
└── docker/                      # Containers
```

## 🏗️ Architecture Overview

### Microservices Agents
1. **Inventory Agent** - Product & stock management
2. **Sales Agent** - Transaction processing
3. **Payment Agent** - Payment handling
4. **Analytics Agent** - Business intelligence
5. **Customer Agent** - CRM & loyalty
6. **Integration Agent** - Data sync (SQLite ↔ API)

### Clean Architecture Layers
- **Domain**: Business entities & rules
- **Application**: Use cases & services
- **Infrastructure**: Repositories & adapters
- **Presentation**: UI components

### Repository Pattern
```typescript
// Switch between SQLite and API
const repo = RepositoryFactory.create('sqlite' | 'api');
```

## ☁️ IBM Cloud Deployment

### Setup Terraform

```bash
cd terraform/environments/dev

# Initialize
terraform init

# Plan
terraform plan -out=tfplan

# Apply
terraform apply tfplan
```

### Environment Variables

```bash
export IC_API_KEY="your-ibm-cloud-api-key"
export TF_VAR_ibmcloud_api_key="your-api-key"
export TF_VAR_db_admin_password="secure-password"
export TF_VAR_stripe_api_key="your-stripe-key"
```

### Build & Deploy

```bash
# Build Docker images
docker build -t us.icr.io/capy-pos/frontend:latest -f docker/Dockerfile.frontend .
docker build -t us.icr.io/capy-pos/inventory:latest -f docker/Dockerfile.inventory .

# Push to IBM Container Registry
docker push us.icr.io/capy-pos/frontend:latest
docker push us.icr.io/capy-pos/inventory:latest

# Deploy with Terraform
cd terraform/environments/production
terraform apply -auto-approve
```

## 🧪 Testing

### Unit Tests
```bash
npm run test
```

### E2E Tests (Playwright)
```bash
npm run test:e2e
```

### BDD Tests (Cucumber)
```bash
npm run test:cucumber
```

### Component Tests (Storybook)
```bash
npm run storybook
```

## 📊 Monitoring

- **Logs**: IBM Log Analysis
- **Metrics**: IBM Monitoring
- **APM**: Sysdig

## 🔒 Security

- Authentication: IBM App ID
- Secrets: IBM Secrets Manager
- Encryption: TLS 1.3, AES-256

## 📚 Documentation

- [Architecture](./ARCHITECTURE.md)
- [Terraform Setup](../terraform/README.md)
- [API Documentation](./docs/api/)

## 🆘 Support

- GitHub Issues: [Report bugs](https://github.ibm.com/your-org/capy-pos/issues)
- Slack: #capy-pos-support
- Email: support@capy-pos.com

## 📝 License

MIT License - See LICENSE file