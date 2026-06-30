# Grafana Cloud Setup for Capy-POS Failure Injection Demo

## Overview

This setup provisions a Grafana dashboard to visualize the failure-injection impact:
- **HTTP latency spikes** (25s delay when `ENABLE_FAILURE=true`)
- **Error rate increase** (5xx responses during failures)
- **DynamoDB operation duration** (correlates with slow queries)
- **Sync health** (offline queue impact)

## Prerequisites

1. **Grafana Cloud Account**: https://freshmannasoft.grafana.net
2. **API Token**: Create via Grafana → Settings → Organization → Create API Token
3. **Prometheus Data Source**: Already configured in Grafana Cloud (auto-provisioned)
4. **OTLP Endpoint**: `https://otlp-gateway-prod-us-east-3.grafana.net/otlp`

## Deployment

### Option 1: Terraform (Recommended)

```bash
cd terraform/aws-demo

# Set environment variables
export GRAFANA_URL="https://freshmannasoft.grafana.net"
export GRAFANA_API_TOKEN="glc_..."  # Your Grafana Cloud token

# Plan & apply
terraform init
terraform plan
terraform apply
```

The dashboard will be created at: `https://freshmannasoft.grafana.net/d/capy-pos-failure-demo`

### Option 2: Manual (Grafana UI)

1. Log into Grafana Cloud: https://freshmannasoft.grafana.net
2. Go to Dashboards → New → Import
3. Upload `grafana-dashboard.json`
4. Select Prometheus as data source
5. Click Import

## Environment Configuration

Add these to Lambda function environment variables:

```
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-us-east-3.grafana.net/otlp
GRAFANA_OTLP_API_KEY=<your-grafana-cloud-api-token>
ENVIRONMENT=production
```

## Triggering the Demo

### Local Development

1. Set `ENABLE_FAILURE=true` in `.env.production` (for demo builds)
2. Deploy Lambda with failure injection enabled
3. Make API requests (e.g., `GET /api/products`)
4. Watch Grafana dashboard in real-time:
   - **Latency panel**: p95/p99 spike to ~25s
   - **Error rate**: 100% (all requests timeout)
   - **DynamoDB duration**: Spike during 25s delay
   - **Sync health**: Failed sync attempts spike

### Production Verification

Disable failure injection (`ENABLE_FAILURE=false`) and verify:
- Latency returns to normal (~50-100ms)
- Error rate drops to 0%
- All metrics normalize

## Dashboard Panels

| Panel | Metric | Threshold | Alert |
|-------|--------|-----------|-------|
| HTTP Latency (p95/p99) | HTTP request duration | p95 > 1s | Warning |
| Error Rate (5xx) | % of 5xx responses | > 5% | Critical |
| DynamoDB Duration | Query duration | p99 > 5s | Warning |
| Sync Health | Queue depth / success rate | Sync failures > 10% | Info |

## Testing Traces

### View traces in Grafana

1. Go to Explore → Tempo (or Loki via trace backend)
2. Search by trace ID (available in `X-Trace-Id` response header)
3. Inspect spans:
   - `HTTP GET /api/products` (frontend span)
   - `DynamoDB ScanCommand` (backend span)
   - Links show parent/child relationship

### Correlate Frontend ↔ Backend

Frontend trace ID (from browser DevTools):
```
X-Trace-Id: 4bf92f3577b34da6a3ce929d0e0e4736
```

Backend Lambda logs (CloudWatch):
```json
{
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "awsTraceId": "1-...",
  "message": "GetProducts invoked",
  "level": "info"
}
```

Both trace IDs should match → full end-to-end tracing ✓

## Teardown

```bash
terraform destroy
```

This removes the dashboard but keeps the OTLP data source (safe to re-apply).

## Troubleshooting

### Traces not appearing in Grafana
- Verify `GRAFANA_OTLP_API_KEY` is set correctly
- Check Lambda CloudWatch logs for OTLP export errors
- Ensure Lambda has internet access (VPC NAT / PrivateLink)

### Dashboard empty / no data
- Verify Prometheus data source is configured
- Check that metrics are being scraped (Prometheus → Targets)
- Wait 5-10 minutes for first metrics to ingest

### Latency not spiking during failure injection
- Verify `ENABLE_FAILURE=true` is set on Lambda
- Check Lambda logs for "FAILURE_SCENARIO" entries
- Make sure you're hitting the correct API endpoint
