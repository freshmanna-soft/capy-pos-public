output "app_url" {
  description = "The public URL of the deployed Capy-POS application"
  value       = ibm_code_engine_app.app.endpoint
}

output "project_id" {
  description = "Code Engine project ID"
  value       = ibm_code_engine_project.project.project_id
}

output "cr_namespace" {
  description = "Container Registry namespace"
  value       = ibm_cr_namespace.namespace.name
}
