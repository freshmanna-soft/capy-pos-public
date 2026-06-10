variable "ibmcloud_api_key" {
  description = "IBM Cloud API key"
  type        = string
  sensitive   = true
}

variable "region" {
  description = "IBM Cloud region"
  type        = string
  default     = "us-south"
}

variable "resource_group_name" {
  description = "IBM Cloud resource group name"
  type        = string
  default     = "Default"
}

variable "project_name" {
  description = "Code Engine project name"
  type        = string
  default     = "capy-pos"
}

variable "app_name" {
  description = "Code Engine application name"
  type        = string
  default     = "capy-pos-app"
}

variable "image_tag" {
  description = "Container image tag"
  type        = string
  default     = "latest"
}

variable "cr_namespace" {
  description = "IBM Container Registry namespace"
  type        = string
  default     = "capy-pos"
}
