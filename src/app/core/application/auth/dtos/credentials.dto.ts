/**
 * CredentialsDto
 *
 * Input DTO for the authenticate use-case / port.
 * Carries only what is needed to verify identity — no secrets retained beyond the call.
 */
export interface CredentialsDto {
  readonly email: string;
  readonly password: string;
}
