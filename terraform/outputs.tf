output "app_urls" {
  description = "Public endpoint of every Code Engine app, keyed by app name"
  value       = { for name, app in ibm_code_engine_app.apps : name => app.endpoint }
}

output "app_url" {
  description = "The public URL of the deployed Capy-POS frontend"
  # `try` rather than a bare index: renaming the frontend key in `var.services`
  # should not fail the plan on an output that only exists for continuity with the
  # single-app version of this module.
  value = try(ibm_code_engine_app.apps["capy-pos-app"].endpoint, "")
}

output "vision_proxy_url" {
  description = "Base URL for visionApiUrl in the environment file being deployed (append /vision/identify)"
  value       = try(ibm_code_engine_app.apps["capy-vision-proxy"].endpoint, "")
}

output "clerk_agent_relay_url" {
  description = "Base URL for clerkAgentApiUrl in the environment file being deployed (append /clerk/agent)"
  value       = try(ibm_code_engine_app.apps["capy-clerk-agent-relay"].endpoint, "")
}

output "pos_api_url" {
  description = "Base URL for apiUrl in the environment file being deployed"
  value       = try(ibm_code_engine_app.apps["capy-pos-api"].endpoint, "")
}

output "appid_token_relay_url" {
  description = "Base URL for appId.relayUrl in the environment file being deployed (append /appid/token)"
  value       = try(ibm_code_engine_app.apps["capy-appid-token-relay"].endpoint, "")
}

output "checkout_migration_jobs" {
  description = "Checkout migration Code Engine job names, keyed by service"
  value       = { for name, job in ibm_code_engine_job.checkout_migration : name => job.name }
}

output "checkout_reconciliation_jobs" {
  description = "Checkout reconciliation Code Engine job names, keyed by service"
  value       = { for name, job in ibm_code_engine_job.checkout_reconciliation : name => job.name }
}

output "loyalty_migration_jobs" {
  description = "Loyalty migration Code Engine job names, keyed by service"
  value       = { for name, job in ibm_code_engine_job.loyalty_migration : name => job.name }
}

output "loyalty_reconciliation_jobs" {
  description = "Loyalty reconciliation Code Engine job names, keyed by service"
  value       = { for name, job in ibm_code_engine_job.loyalty_reconciliation : name => job.name }
}

output "checkout_reconciliation_schedule" {
  description = "Cron schedule to apply out of band to each checkout reconciliation job"
  value       = var.checkout_reconciliation_schedule
}

output "checkout_reconciliation_time_zone" {
  description = "Time zone to apply out of band to each checkout reconciliation cron subscription"
  value       = var.checkout_reconciliation_time_zone
}

output "project_id" {
  description = "Code Engine project ID"
  value       = ibm_code_engine_project.project.project_id
}

output "cr_namespace" {
  description = "Container Registry namespace"
  value       = ibm_cr_namespace.namespace.name
}
