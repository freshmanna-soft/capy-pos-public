# The frontend was `ibm_code_engine_app.app` until story #197 turned one hardcoded
# app into a `for_each` over `var.services`. Without this block Terraform reads the
# rename as "destroy the app that is serving the till, create a new one with a new
# URL" — so it is here to make the generalization a no-op for the running frontend.
#
# The index is a literal because `moved` addresses cannot contain variables; it
# matches the `capy-pos-app` key in `var.services`' default. Safe to delete once
# every state file has been applied through it.
moved {
  from = ibm_code_engine_app.app
  to   = ibm_code_engine_app.apps["capy-pos-app"]
}
