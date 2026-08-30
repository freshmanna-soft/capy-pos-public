/**
 * Sync backend authorizer handler (issue #206).
 *
 * Unit tests for `terraform/aws-demo/lambda/authorizer/index.js`, the REQUEST
 * authorizer that now sits in front of every route except `GET /api/health`.
 *
 * It lives under `src/` because that is where the vitest `include` glob looks
 * (`src/**\/*.spec.ts`), the same reason the persistence guard in
 * `core/infrastructure/database/` does. The subject is backend infrastructure
 * rather than app code, but it is the authorizer for the backend this very
 * directory's sync worker talks to, and the alternative — a Lambda whose only
 * verification is "we ran terraform apply and the API still answered" — is how a
 * fail-open authorizer ships unnoticed.
 *
 * The branches worth asserting are the ones that fail *open*: a missing token
 * configuration, a missing header, and a comparison that accepts a prefix. Each is
 * a way for the control added in #206 to exist on paper and allow anyone through.
 */

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const require_ = createRequire(import.meta.url);

/** The real handler, loaded from the Terraform tree it will be zipped from. */
const { handler } = require_(
  resolve(process.cwd(), 'terraform/aws-demo/lambda/authorizer/index.js')
) as {
  handler: (event: unknown) => Promise<{ isAuthorized: boolean }>;
};

const TOKEN = 'sk-capy-b9tQ2m4XvR7pLdN1';

/** An API Gateway HTTP API 2.0 authorizer event with the given headers. */
function event(headers: Record<string, string> = {}) {
  return {
    routeKey: 'POST /api/products',
    headers,
    requestContext: { http: { sourceIp: '203.0.113.7' } },
  };
}

describe('sync backend authorizer handler (#206)', () => {
  let logs: string[];

  beforeEach(() => {
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      logs.push(String(line));
    });
    process.env.API_SERVICE_TOKEN = TOKEN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.API_SERVICE_TOKEN;
  });

  describe('fails closed', () => {
    it('denies when API_SERVICE_TOKEN is not configured', async () => {
      // A half-configured deploy must be unusable, not open. This is the branch
      // that would otherwise turn a Terraform mistake into a public API.
      delete process.env.API_SERVICE_TOKEN;

      await expect(handler(event({ authorization: `Bearer ${TOKEN}` }))).resolves.toEqual({
        isAuthorized: false,
      });
    });

    it('denies when API_SERVICE_TOKEN is blank', async () => {
      process.env.API_SERVICE_TOKEN = '';

      await expect(handler(event({ authorization: 'Bearer ' }))).resolves.toEqual({
        isAuthorized: false,
      });
    });

    it('logs the misconfiguration at error level so it is findable', async () => {
      delete process.env.API_SERVICE_TOKEN;

      await handler(event({ authorization: `Bearer ${TOKEN}` }));

      expect(logs.join('\n')).toContain('API_SERVICE_TOKEN is not configured');
      expect(JSON.parse(logs[0]).level).toBe('error');
    });

    it('denies when no Authorization header is present', async () => {
      await expect(handler(event())).resolves.toEqual({ isAuthorized: false });
    });
  });

  describe('token comparison', () => {
    it('allows the correct token behind a Bearer prefix', async () => {
      await expect(handler(event({ authorization: `Bearer ${TOKEN}` }))).resolves.toEqual({
        isAuthorized: true,
      });
    });

    it('allows a bare token with no scheme', async () => {
      await expect(handler(event({ authorization: TOKEN }))).resolves.toEqual({
        isAuthorized: true,
      });
    });

    it.each(['bearer', 'BEARER', 'Bearer'])(
      'treats the %s scheme case-insensitively',
      async (scheme) => {
        await expect(handler(event({ authorization: `${scheme} ${TOKEN}` }))).resolves.toEqual({
          isAuthorized: true,
        });
      }
    );

    it('reads the capitalised header name as a fallback', async () => {
      // The 2.0 payload lowercases header keys, but nothing in the contract
      // promises that for a direct invoke or a future payload version.
      await expect(handler(event({ Authorization: `Bearer ${TOKEN}` }))).resolves.toEqual({
        isAuthorized: true,
      });
    });

    it('denies a wrong token of the same length', async () => {
      const wrong = `${TOKEN.slice(0, -1)}X`;

      await expect(handler(event({ authorization: `Bearer ${wrong}` }))).resolves.toEqual({
        isAuthorized: false,
      });
    });

    it.each([
      ['a prefix of the real token', TOKEN.slice(0, 8)],
      ['the real token plus a suffix', `${TOKEN}extra`],
      ['an empty token after the scheme', 'Bearer    '],
    ])('denies %s', async (_case, presented) => {
      // Hashing before `timingSafeEqual` is what makes differing lengths
      // comparable at all; without it the call throws and the handler would 500
      // — which API Gateway treats as a denial, but noisily and for the wrong
      // reason.
      await expect(handler(event({ authorization: presented }))).resolves.toEqual({
        isAuthorized: false,
      });
    });
  });

  describe('logging', () => {
    it('never writes the presented token, even on a failed attempt', async () => {
      const attempt = 'sk-capy-GUESSED-SECRET-VALUE';

      await handler(event({ authorization: `Bearer ${attempt}` }));

      // A logged prefix plus retries is a brute-force oracle in CloudWatch.
      expect(logs.join('\n')).not.toContain(attempt);
      expect(logs.join('\n')).not.toContain(TOKEN);
    });

    it('records the route and source IP of a denial', async () => {
      await handler(event({ authorization: 'Bearer nope' }));

      const entry = JSON.parse(logs[0]);
      expect(entry.level).toBe('warn');
      expect(entry.route).toBe('POST /api/products');
      expect(entry.sourceIp).toBe('203.0.113.7');
    });

    it('emits structured JSON, matching the shared logger shape', async () => {
      await handler(event({ authorization: `Bearer ${TOKEN}` }));

      const entry = JSON.parse(logs[0]);
      expect(entry).toMatchObject({ level: 'info', message: 'Authorizer allowed' });
      expect(typeof entry.timestamp).toBe('string');
    });
  });
});
