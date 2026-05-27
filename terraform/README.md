# Terraform Infrastructure for Capy-POS

## Overview
This directory contains Terraform configurations for deploying the Capy-POS microservices architecture to IBM Cloud Code Engine.

## Prerequisites

1. **IBM Cloud Account**
   - Active IBM Cloud account
   - API key with appropriate permissions
   - Resource group created

2. **Tools Required**
   - Terraform >= 1.5.0
   - IBM Cloud CLI
   - Docker
   - kubectl (optional, for debugging)

3. **Environment Variables**
   ```bash
   export IC_API_KEY="your-ibm-cloud-api-key"
   export TF_VAR_ibmcloud_api_key="your-ibm-cloud-api-key"
   export TF_VAR_region="us-south"
   ```

## Directory Structure

```
terraform/
├── main.tf                 # Main configuration
├── variables.tf            # Input variables
├── outputs.tf              # Output values
├── providers.tf            # Provider configuration
├── versions.tf             # Version constraints
├── modules/
│   ├── code-engine/        # Code Engine resources
│   ├── database/           # Database resources
│   ├── storage/            # Object storage
│   ├── networking/         # Networking & security
│   └── monitoring/         # Logging & monitoring
└── environments/
    ├── dev/                # Development environment
    ├── staging/            # Staging environment
    └── production/         # Production environment
```

## Quick Start

### 1. Initialize Terraform
```bash
cd terraform/environments/dev
terraform init
```

### 2. Plan Deployment
```bash
terraform plan -out=tfplan
```

### 3. Apply Configuration
```bash
terraform apply tfplan
```

### 4. Verify Deployment
```bash
terraform output
```

## Environment-Specific Configurations

### Development
- Minimal resources
- Single instance per service
- SQLite for local development
- No auto-scaling

### Staging
- Medium resources
- 1-3 instances per service
- PostgreSQL database
- Limited auto-scaling

### Production
- High availability
- 2-10 instances per service
- PostgreSQL with read replicas
- Full auto-scaling
- CDN enabled
- Enhanced monitoring

## Resource Naming Convention

```
{project}-{service}-{environment}-{resource-type}

Examples:
- capy-pos-inventory-prod-app
- capy-pos-sales-staging-db
- capy-pos-frontend-dev-storage
```

## Cost Estimation

### Development Environment
- Code Engine: ~$20/month
- Database: ~$30/month
- Storage: ~$5/month
- **Total: ~$55/month**

### Production Environment
- Code Engine: ~$200/month
- Database: ~$150/month
- Storage: ~$20/month
- Monitoring: ~$30/month
- **Total: ~$400/month**

## Security Best Practices

1. **Secrets Management**
   - Use IBM Secrets Manager
   - Never commit secrets to Git
   - Rotate credentials regularly

2. **Network Security**
   - Private endpoints for databases
   - VPC isolation
   - Security groups

3. **Access Control**
   - IAM policies
   - Service-to-service authentication
   - Least privilege principle

## Monitoring & Alerts

### Key Metrics to Monitor
- Application response time
- Error rates
- Database connections
- Memory/CPU usage
- Request throughput

### Alert Thresholds
- Error rate > 5%
- Response time > 3s
- CPU usage > 80%
- Memory usage > 85%

## Disaster Recovery

### Backup Strategy
- **Database:** Daily automated backups
- **Object Storage:** Versioning enabled
- **Configuration:** Terraform state in remote backend

### Recovery Time Objective (RTO)
- Development: 4 hours
- Staging: 2 hours
- Production: 30 minutes

### Recovery Point Objective (RPO)
- Development: 24 hours
- Staging: 12 hours
- Production: 1 hour

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   ```bash
   # Verify API key
   ibmcloud login --apikey $IC_API_KEY
   
   # Check permissions
   ibmcloud iam user-policies $USER_EMAIL
   ```

2. **Resource Quota Exceeded**
   ```bash
   # Check quotas
   ibmcloud resource quotas
   
   # Request increase
   ibmcloud support case-create
   ```

3. **Deployment Failures**
   ```bash
   # Check Code Engine logs
   ibmcloud ce app logs --name inventory-agent
   
   # Describe application
   ibmcloud ce app get --name inventory-agent
   ```

## Maintenance

### Regular Tasks
- [ ] Weekly: Review logs and metrics
- [ ] Monthly: Update dependencies
- [ ] Quarterly: Review and optimize costs
- [ ] Annually: Disaster recovery drill

### Terraform State Management
```bash
# List state resources
terraform state list

# Show specific resource
terraform state show ibm_code_engine_app.inventory_agent

# Import existing resource
terraform import ibm_code_engine_app.inventory_agent <resource-id>
```

## CI/CD Integration

### GitHub Actions
```yaml
- name: Terraform Apply
  env:
    IC_API_KEY: ${{ secrets.IBM_CLOUD_API_KEY }}
  run: |
    cd terraform/environments/${{ github.ref_name }}
    terraform init
    terraform apply -auto-approve
```

### GitLab CI
```yaml
terraform:
  script:
    - cd terraform/environments/$CI_COMMIT_REF_NAME
    - terraform init
    - terraform apply -auto-approve
  only:
    - main
    - develop
```

## Support & Documentation

- [IBM Cloud Code Engine Docs](https://cloud.ibm.com/docs/codeengine)
- [Terraform IBM Provider](https://registry.terraform.io/providers/IBM-Cloud/ibm/latest/docs)
- [Project Architecture](../ARCHITECTURE.md)

## License
MIT License - See LICENSE file for details