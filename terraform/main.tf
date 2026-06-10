# Data source: Resource Group
data "ibm_resource_group" "group" {
  name = var.resource_group_name
}

# Container Registry Namespace
resource "ibm_cr_namespace" "namespace" {
  name              = var.cr_namespace
  resource_group_id = data.ibm_resource_group.group.id
}

# Code Engine Project
resource "ibm_code_engine_project" "project" {
  name              = var.project_name
  resource_group_id = data.ibm_resource_group.group.id
}

# Code Engine Secret for Container Registry access
resource "ibm_code_engine_secret" "cr_secret" {
  project_id = ibm_code_engine_project.project.project_id
  name       = "icr-secret"
  format     = "registry"

  data = {
    server   = "us.icr.io"
    username = "iamapikey"
    password = var.ibmcloud_api_key
  }
}

# Code Engine Application
resource "ibm_code_engine_app" "app" {
  project_id = ibm_code_engine_project.project.project_id
  name       = var.app_name

  image_reference = "us.icr.io/${var.cr_namespace}/${var.app_name}:${var.image_tag}"
  image_secret    = ibm_code_engine_secret.cr_secret.name

  image_port = 8080

  scale_min_instances     = 0
  scale_max_instances     = 2
  scale_cpu_limit         = "0.5"
  scale_memory_limit      = "1G"
  scale_initial_instances = 1

  run_env_variables {
    type  = "literal"
    name  = "NODE_ENV"
    value = "production"
  }
}
