# Capy-POS Architecture Plan

> ## ⚠️ Status: this is a **plan**, not a description of the running system
>
> This document is the original target architecture, kept for the design intent behind it. Most of
> what follows has **not** been built, and several sections describe a system meaningfully different
> from the one in this repo. Do not use it to reason about what exists today.
>
> Where it and the code disagree, **the code and the docs below are authoritative:**
>
> | For            | Read                                                                                  |
> | -------------- | ------------------------------------------------------------------------------------- |
> | Persistence    | [`DEXIE_MIGRATION.md`](DEXIE_MIGRATION.md) — the store is Dexie (IndexedDB).          |
> | Infrastructure | [`../terraform/README.md`](../terraform/README.md) — what Terraform actually creates. |
> | Current state  | [`PROJECT_STATUS.md`](PROJECT_STATUS.md)                                              |
>
> The largest gaps, so nobody has to rediscover them:
>
> - **No backend microservices.** The six "agents" below are described with `/api/*` HTTP endpoints
>   and a database each. In the repo they are in-browser TypeScript classes under `src/app/agents/`
>   that talk to local Dexie tables — there is no service per agent, and no `/api/inventory/*`-style
>   API. The only real deployable services are `infra/{pos-api,vision-proxy,clerk-agent-relay}`,
>   which do not map onto this list.
> - **Not SQLite, and no PostgreSQL/Redis.** Every "Database: SQLite (local) / PostgreSQL (cloud)"
>   line below is obsolete: the app migrated off sql.js / `better-sqlite3` to Dexie, and no managed
>   database, cache or object store is provisioned by any Terraform in this repo.
> - **Deployment.** The frontend is published to **GitHub Pages** by
>   `.github/workflows/deploy-pages.yml` on every push to `main` — that is the deployment path in
>   daily use. `terraform/` is a real, maintained IBM Cloud Code Engine root module (three apps:
>   frontend, vision proxy, clerk relay), but whether any given state file has been applied is not
>   something this repo records. The AWS estate under `terraform/aws-demo/` is torn down (see issue
>   #206).
> - **The IBM services in "Infrastructure Components"** (Databases for PostgreSQL, Object Storage,
>   Internet Services/CDN, Log Analysis, Monitoring, Sysdig) are aspirational. None are declared in
>   `terraform/`.

## 🎯 Project Overview

Enterprise-grade Point of Sale (POS) system built with Angular 21+, a clean-architecture frontend,
and offline-first local persistence.

**Running today as a real pilot, not just a demo.** A small snack bar in the office sells real
goods through it. There is no cashier: each coworker self-checks-out on their **own phone** —
Capy Clerk (`/clerk`) recognizes the item through the phone's own camera and mic, rings it up, and
takes payment, honor-system-adjacent. That means real concurrent load from many personal devices
(not one attended till), and it's the reason the vision-recognition path
(`infra/vision-proxy`/`infra/clerk-agent-relay`) is cost- and confidence-gated as carefully as it
is (`FrameGate`, the near-tie auto-add cap in `candidate-ranking.ts`) — a wrong or overconfident
call has nobody standing at a register to catch it. The pilot's purpose is finding out what breaks
under that real usage before any of this becomes a shipped Freshmanna retail product.

**Planned:** a microservices backend deployed to IBM Cloud Code Engine using Terraform. See the
status note above for what of that exists.

## 🏗️ Architecture Principles

### SOLID Principles

- **S**ingle Responsibility: Each agent handles one business domain
- **O**pen/Closed: Extensible through interfaces, closed for modification
- **L**iskov Substitution: All implementations are interchangeable
- **I**nterface Segregation: Focused, minimal interfaces
- **D**ependency Inversion: Depend on abstractions, not concretions

### Clean Architecture Layers

```
┌─────────────────────────────────────────┐
│         Presentation Layer              │
│    (Angular Components, UI)             │
├─────────────────────────────────────────┤
│         Application Layer               │
│    (Use Cases, Services, State)         │
├─────────────────────────────────────────┤
│         Domain Layer                    │
│    (Entities, Value Objects, Rules)     │
├─────────────────────────────────────────┤
│         Infrastructure Layer            │
│    (Repositories, APIs, SQLite)         │
└─────────────────────────────────────────┘
```

## 🤖 Microservices Agent Architecture

### Agent 1: Inventory Agent

**Responsibility:** Product catalog and stock management

- **Domain Models:** Product, Category, Stock, Supplier
- **Use Cases:**
  - Add/Update/Delete products
  - Track inventory levels
  - Low stock alerts
  - Supplier management
- **API Endpoints:** `/api/inventory/*`
- **Database:** SQLite (local) / PostgreSQL (cloud)

### Agent 2: Sales Agent

**Responsibility:** Transaction processing and cart management

- **Domain Models:** Cart, CartItem, Transaction, Discount
- **Use Cases:**
  - Create/Update cart
  - Apply discounts
  - Process sales
  - Generate receipts
- **API Endpoints:** `/api/sales/*`
- **Database:** SQLite (local) / PostgreSQL (cloud)

### Agent 3: Payment Agent

**Responsibility:** Payment processing and reconciliation

- **Domain Models:** Payment, PaymentMethod, Receipt, Refund
- **Use Cases:**
  - Process payments (cash, card, digital)
  - Handle refunds
  - Payment reconciliation
  - Receipt generation
- **API Endpoints:** `/api/payments/*`
- **Integration:** Payment gateways (Stripe, Square)

### Agent 4: Analytics Agent

**Responsibility:** Business intelligence and reporting

- **Domain Models:** Report, Metric, Dashboard, Insight
- **Use Cases:**
  - Sales analytics
  - Inventory reports
  - Customer insights
  - Revenue tracking
- **API Endpoints:** `/api/analytics/*`
- **Database:** Time-series data store

### Agent 5: Customer Agent

**Responsibility:** Customer relationship management

- **Domain Models:** Customer, LoyaltyProgram, Reward, Profile
- **Use Cases:**
  - Customer registration
  - Loyalty points
  - Purchase history
  - Customer preferences
- **API Endpoints:** `/api/customers/*`
- **Database:** SQLite (local) / PostgreSQL (cloud)

### Agent 6: Integration Agent

**Responsibility:** Data abstraction and external integrations

- **Domain Models:** DataSource, SyncJob, ApiConfig
- **Use Cases:**
  - SQLite ↔ API synchronization
  - External system integration
  - Data migration
  - Offline/online mode switching
- **API Endpoints:** `/api/integration/*`
- **Pattern:** Repository Pattern with Strategy Pattern

## 📁 Project Structure

```
capy-pos/
├── src/
│   ├── app/
│   │   ├── core/                    # Core functionality
│   │   │   ├── domain/              # Domain layer
│   │   │   │   ├── entities/        # Business entities
│   │   │   │   ├── value-objects/   # Value objects
│   │   │   │   ├── interfaces/      # Domain interfaces
│   │   │   │   └── rules/           # Business rules
│   │   │   ├── application/         # Application layer
│   │   │   │   ├── use-cases/       # Use case implementations
│   │   │   │   ├── services/        # Application services
│   │   │   │   ├── ports/           # Input/Output ports
│   │   │   │   └── state/           # State management (signals)
│   │   │   └── infrastructure/      # Infrastructure layer
│   │   │       ├── repositories/    # Data repositories
│   │   │       ├── adapters/        # External adapters
│   │   │       ├── sqlite/          # SQLite implementation
│   │   │       └── api/             # API clients
│   │   │
│   │   ├── agents/                  # Microservices agents
│   │   │   ├── inventory/
│   │   │   │   ├── domain/
│   │   │   │   ├── application/
│   │   │   │   ├── infrastructure/
│   │   │   │   └── presentation/
│   │   │   ├── sales/
│   │   │   ├── payment/
│   │   │   ├── analytics/
│   │   │   ├── customer/
│   │   │   └── integration/
│   │   │
│   │   ├── shared/                  # Shared resources
│   │   │   ├── ui/                  # Micro UI components
│   │   │   │   ├── atoms/           # Basic components
│   │   │   │   ├── molecules/       # Composite components
│   │   │   │   ├── organisms/       # Complex components
│   │   │   │   └── templates/       # Page templates
│   │   │   ├── utils/               # Utility functions
│   │   │   ├── models/              # Shared models
│   │   │   └── constants/           # Constants
│   │   │
│   │   └── features/                # Feature modules
│   │       ├── dashboard/
│   │       ├── pos-terminal/
│   │       ├── inventory-management/
│   │       ├── reports/
│   │       └── settings/
│   │
├── tests/
│   ├── e2e/                         # Playwright E2E tests
│   │   ├── features/                # Cucumber feature files
│   │   ├── step-definitions/        # Step implementations
│   │   └── support/                 # Test utilities
│   ├── integration/                 # Integration tests
│   └── unit/                        # Unit tests
│
├── .storybook/                      # Storybook configuration
├── terraform/                       # Infrastructure as Code
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── modules/
│   │   ├── code-engine/
│   │   ├── database/
│   │   ├── storage/
│   │   └── networking/
│   └── environments/
│       ├── dev/
│       ├── staging/
│       └── production/
│
├── docker/                          # Docker configurations
│   ├── Dockerfile.inventory
│   ├── Dockerfile.sales
│   ├── Dockerfile.payment
│   ├── Dockerfile.analytics
│   ├── Dockerfile.customer
│   ├── Dockerfile.integration
│   └── docker-compose.yml
│
└── docs/                            # Documentation
    ├── api/
    ├── architecture/
    └── deployment/
```

## 🎨 Micro UI Component Library

### Atomic Design System

```
Atoms (Basic building blocks)
├── Button
├── Input
├── Label
├── Icon
├── Badge
└── Spinner

Molecules (Simple combinations)
├── FormField (Label + Input)
├── SearchBar (Input + Icon)
├── PriceTag (Label + Badge)
└── ActionButton (Button + Icon)

Organisms (Complex components)
├── ProductCard
├── CartSummary
├── PaymentForm
├── DataTable
└── NavigationBar

Templates (Page layouts)
├── DashboardLayout
├── POSLayout
├── ReportLayout
└── SettingsLayout
```

## 🗄️ Data Layer Architecture

> **Partly obsolete.** The repository pattern below is real and in use; the SQLite strategy is not.
> `SQLiteProductRepository` and the `'sqlite' | 'api'` factory were deleted when the app moved to
> Dexie — see [`DEXIE_MIGRATION.md`](DEXIE_MIGRATION.md) for the interfaces that actually exist.

### Repository Pattern with Strategy

```typescript
// Abstract repository interface
interface IRepository<T> {
  findAll(): Promise<T[]>;
  findById(id: string): Promise<T | null>;
  create(entity: T): Promise<T>;
  update(id: string, entity: T): Promise<T>;
  delete(id: string): Promise<void>;
}

// SQLite implementation
class SQLiteProductRepository implements IRepository<Product> {
  // SQLite-specific implementation
}

// API implementation
class ApiProductRepository implements IRepository<Product> {
  // REST API implementation
}

// Factory pattern for switching
class RepositoryFactory {
  static createProductRepository(type: 'sqlite' | 'api'): IRepository<Product> {
    return type === 'sqlite' ? new SQLiteProductRepository() : new ApiProductRepository();
  }
}
```

## ☁️ IBM Cloud Code Engine Deployment

> **Planned, not provisioned.** Nothing in this section is created by any Terraform in this repo.
> `terraform/` stands up a Code Engine project, a Container Registry namespace, secrets and three
> apps — no managed PostgreSQL, Redis, Object Storage, CDN or Sysdig, and no per-agent backend
> service. The Terraform snippet below is illustrative and does not match `terraform/main.tf`; read
> [`../terraform/README.md`](../terraform/README.md) for what is real.

### Infrastructure Components

#### 1. Code Engine Applications

- **Frontend App:** Angular SPA
- **Backend Services:** 6 microservice agents
- **Auto-scaling:** 0-10 instances per service
- **Resource Allocation:**
  - CPU: 0.5-2 vCPU per instance
  - Memory: 512MB-4GB per instance

#### 2. Databases

- **IBM Cloud Databases for PostgreSQL:** Production data
- **IBM Cloud Object Storage:** File storage, backups
- **Redis:** Caching layer

#### 3. Networking

- **IBM Cloud Internet Services:** CDN, DDoS protection
- **Private Endpoints:** Secure service communication
- **API Gateway:** Rate limiting, authentication

#### 4. Monitoring & Logging

- **IBM Log Analysis:** Centralized logging
- **IBM Monitoring:** Metrics and alerts
- **Sysdig:** Application performance monitoring

### Terraform Configuration Structure

```hcl
# main.tf
terraform {
  required_providers {
    ibm = {
      source = "IBM-Cloud/ibm"
      version = "~> 1.60"
    }
  }
}

# Code Engine project
resource "ibm_code_engine_project" "capy_pos" {
  name              = "capy-pos-${var.environment}"
  resource_group_id = var.resource_group_id
}

# Each microservice agent
resource "ibm_code_engine_app" "inventory_agent" {
  project_id      = ibm_code_engine_project.capy_pos.id
  name            = "inventory-agent"
  image_reference = var.inventory_image

  scale_cpu_limit      = "2"
  scale_memory_limit   = "4G"
  scale_min_instances  = 0
  scale_max_instances  = 10

  env {
    name  = "DATABASE_URL"
    value = ibm_database.postgres.connectionstrings[0].composed
  }
}

# PostgreSQL database
resource "ibm_database" "postgres" {
  name              = "capy-pos-db-${var.environment}"
  plan              = "standard"
  location          = var.region
  service           = "databases-for-postgresql"
  resource_group_id = var.resource_group_id

  adminpassword = var.db_admin_password

  group {
    group_id = "member"
    memory {
      allocation_mb = 4096
    }
    disk {
      allocation_mb = 20480
    }
  }
}
```

## 🧪 Testing Strategy

### 1. Unit Tests (Vitest)

- Test individual functions and classes
- Mock dependencies
- Coverage target: 80%+

### 2. Integration Tests (Vitest)

- Test agent interactions
- Test repository implementations
- Test API integrations

### 3. E2E Tests (Playwright + Cucumber)

```gherkin
Feature: Process Sale
  As a cashier
  I want to process a sale
  So that customers can purchase products

  Scenario: Complete a cash sale
    Given I am on the POS terminal
    And the cart is empty
    When I scan product "SKU-001"
    And I click "Complete Sale"
    And I select "Cash" payment method
    And I enter cash amount "50.00"
    Then the sale should be completed
    And a receipt should be generated
    And inventory should be updated
```

### 4. Component Tests (Storybook)

- Visual regression testing
- Interaction testing
- Accessibility testing

## 🚀 CI/CD Pipeline

### GitHub Actions Workflow

```yaml
name: Deploy to IBM Cloud

on:
  push:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run tests
        run: npm test

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Build Docker images
        run:
          docker build -t ${{ secrets.ICR_NAMESPACE }}/inventory-agent:${{ github.sha }} -f
          docker/Dockerfile.inventory .

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Terraform Apply
        run: |
          cd terraform/environments/${{ github.ref_name }}
          terraform init
          terraform apply -auto-approve
```

## 📊 Monitoring & Observability

### Key Metrics

- **Performance:** Response time, throughput
- **Availability:** Uptime, error rates
- **Business:** Sales volume, revenue, inventory turnover
- **User Experience:** Page load time, interaction latency

### Logging Strategy

- **Structured Logging:** JSON format
- **Log Levels:** ERROR, WARN, INFO, DEBUG
- **Correlation IDs:** Track requests across services
- **Sensitive Data:** Mask PII and payment info

## 🔒 Security Considerations

1. **Authentication:** IBM App ID / OAuth 2.0
2. **Authorization:** Role-based access control (RBAC)
3. **Data Encryption:**
   - At rest: AES-256
   - In transit: TLS 1.3
4. **API Security:** Rate limiting, API keys
5. **Compliance:** PCI DSS for payment data

## 📈 Scalability Strategy

### Horizontal Scaling

- Auto-scale based on CPU/memory usage
- Load balancing across instances
- Stateless service design

### Vertical Scaling

- Increase resources per instance
- Optimize database queries
- Implement caching strategies

### Data Scaling

- Database read replicas
- Sharding for large datasets
- Archive old transactions

## 🎯 Success Metrics

### Technical KPIs

- **Deployment Frequency:** Daily
- **Lead Time:** < 1 hour
- **MTTR:** < 30 minutes
- **Change Failure Rate:** < 5%

### Business KPIs

- **Transaction Processing Time:** < 3 seconds
- **System Uptime:** 99.9%
- **User Satisfaction:** > 4.5/5
- **Cost per Transaction:** < $0.01

## 📝 Next Steps

This checklist tracked the original plan. Its state below is as of the #208 hygiene pass — several
items had shipped while still marked pending, and two were superseded rather than completed.

1. ✅ Initialize Git repository
2. ✅ Set up Angular 21+ project
3. ✅ Install dependencies (Playwright, Cucumber, Storybook) — all declared in `package.json`;
   `npm install` is the only step.
4. ✅ Configure UI frameworks (Angular Material, Tailwind)
5. ✅ Implement clean architecture structure — `core/{domain,application,infrastructure}` plus
   `features/`.
6. ❌ Build microservices agents — **not as designed.** `src/app/agents/` are in-browser classes,
   not deployed services. The real services are `infra/{pos-api,vision-proxy,clerk-agent-relay}`.
7. 🚧 Create micro UI components — the atomic-design tree exists under `src/app/shared/ui/`, but
   only part of it is wired into live screens.
8. ➖ Set up SQLite with repository pattern — **superseded.** The repository pattern shipped; the
   store is Dexie, not SQLite (see [`DEXIE_MIGRATION.md`](DEXIE_MIGRATION.md)).
9. ✅ Configure Terraform for IBM Cloud — `terraform/` is a Code Engine root module covering three
   apps (see [`../terraform/README.md`](../terraform/README.md)).
10. 🚧 Create Docker containers — root `Dockerfile` (frontend, also used by `docker-compose.yml`)
    plus `infra/vision-proxy` and `infra/clerk-agent-relay`; `infra/pos-api` has none yet.
11. ✅ Set up CI/CD pipeline — `.github/workflows/ci.yml` and `deploy-pages.yml`.
12. 🚧 Deploy to IBM Cloud Code Engine — the Terraform is written and maintained; the deployment in
    daily use is **GitHub Pages** via `deploy-pages.yml`. Whether a Code Engine state file has been
    applied is not recorded in this repo.

Legend: ✅ done · 🚧 partial · ❌ not built as designed · ➖ superseded.

---

**Version:** 1.0.0  
**Last Updated:** 2026-05-27  
**Author:** Capy-POS Team
