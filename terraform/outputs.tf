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

output "project_id" {
  description = "Code Engine project ID"
  value       = ibm_code_engine_project.project.project_id
}

output "cr_namespace" {
  description = "Container Registry namespace"
  value       = ibm_cr_namespace.namespace.name
}
