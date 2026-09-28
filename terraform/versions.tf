terraform {
  required_version = ">= 1.5.0"

  required_providers {
    ibm = {
      source  = "IBM-Cloud/ibm"
      version = "~> 1.79"
    }
  }

  # IBM Cloud Object Storage backend — stores terraform.tfstate so CI and
  # local runs share the same state. The bucket must exist before the first
  # `terraform init` (create it once manually or via ibmcloud CLI):
  #
  #   ibmcloud cos bucket-create \
  #     --bucket capy-pos-tfstate \
  #     --ibm-service-instance-id <COS_INSTANCE_ID> \
  #     --region us-south \
  #     --class standard
  #
  # Backend values cannot reference var.* (Terraform restriction), so they are
  # passed at `terraform init` time via -backend-config flags. In CI the
  # workflow reads them from GitHub Environment secrets. Locally create a
  # gitignored terraform/backend.hcl:
  #
  #   bucket     = "capy-pos-tfstate"
  #   endpoint   = "s3.us-south.cloud-object-storage.appdomain.cloud"
  #   access_key = "<HMAC access key id>"
  #   secret_key = "<HMAC secret access key>"
  #
  # Then: terraform init -backend-config=backend.hcl
  #
  # GitHub Environment secrets needed (Settings → Environments → production):
  #   TF_BACKEND_BUCKET      e.g. capy-pos-tfstate
  #   TF_BACKEND_ENDPOINT    e.g. s3.us-south.cloud-object-storage.appdomain.cloud
  #   TF_BACKEND_ACCESS_KEY  HMAC access key id from a COS service credential
  #   TF_BACKEND_SECRET_KEY  HMAC secret access key from the same credential
  backend "s3" {
    key                          = "capy-pos/terraform.tfstate"
    region                       = "us-south"
    skip_region_validation       = true
    skip_credentials_validation  = true
    skip_metadata_api_check      = true
    skip_requesting_account_id   = true
    use_path_style               = true
    # IBM COS S3-compatible endpoint — bucket/access_key/secret_key come from
    # -backend-config=backend.hcl locally or -backend-config flags in CI.
    endpoints = {
      s3 = "https://s3.us-south.cloud-object-storage.appdomain.cloud"
    }
  }
}
