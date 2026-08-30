/**
 * Sync backend authorization guard (issue #206).
 *
 * `terraform/aws-demo` is the one real backend the offline-first sync path talks to
 * (`sync.service.ts` → `sync.worker.ts` → `${apiBaseUrl}${endpoints.*}`). It was
 * stood up for a conference talk, and it shipped with **zero** authorizers: no
 * `aws_apigatewayv2_authorizer` resource existed and no route set
 * `authorization_type`, so `POST/PUT/PATCH/DELETE /api/products` and
 * `GET /api/transactions` were writable and readable by anyone who found the
 * hostname. The stack is currently destroyed, which is the only reason that is not
 * true right now — reapplying it as written would put a public write API back.
 *
 * Terraform has no test suite here, so nothing else in this repo fails when a route
 * is public: `terraform validate` accepts an unauthenticated route, and every
 * frontend spec mocks `fetch` and never sees the gateway. This is the test that
 * fails instead, and it asserts the *declaration* in `main.tf` rather than live
 * behaviour, because the point is to catch it before an apply, not after.
 *
 * It reads the real `main.tf` on purpose. A fixture copy would drift the moment
 * someone adds a route, and "every route is authorized" is only a useful claim when
 * "every route" means the ones that would actually be deployed.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const MAIN_TF = resolve(process.cwd(), 'terraform/aws-demo/main.tf');

/**
 * Routes that may stay unauthenticated, with the reason they are safe to expose.
 *
 * Deliberately an allowlist and not a denylist: a new route is private until
 * someone argues otherwise in this file, which is the opposite of how #206
 * happened. Cost prices live on the product payload (`cost?: number` in
 * `sync.types.ts`), so even the catalog read is not public data.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  'GET /api/health': 'liveness probe — reports status/region/flags, no store data',
};

/** Every route declared in `main.tf`, as Terraform would create it. */
interface RouteBlock {
  /** Terraform resource label, e.g. `create_product`. */
  name: string;
  /** `route_key`, e.g. `POST /api/products`. */
  routeKey: string;
  /** `authorization_type`, or undefined when the argument is absent (= NONE). */
  authorizationType?: string;
  /** Raw `authorizer_id` expression, or undefined when absent. */
  authorizerId?: string;
}

/** Value of a simple `key = "value"` / `key = expr` argument inside a block body. */
function argument(body: string, key: string): string | undefined {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'm').exec(body);
  return match ? match[1].replace(/^"|"$/g, '') : undefined;
}

/** Parse every `aws_apigatewayv2_route` block out of an HCL document. */
function parseRoutes(hcl: string): RouteBlock[] {
  // Route blocks contain no nested braces, so "up to the next line that is just a
  // closing brace" delimits them exactly.
  const blocks = /resource\s+"aws_apigatewayv2_route"\s+"([^"]+)"\s*\{([\s\S]*?)^\}/gm;

  return [...hcl.matchAll(blocks)].map(([, name, body]) => ({
    name,
    routeKey: argument(body, 'route_key') ?? '',
    authorizationType: argument(body, 'authorization_type'),
    authorizerId: argument(body, 'authorizer_id'),
  }));
}

describe('sync backend authorization (#206)', () => {
  const hcl = readFileSync(MAIN_TF, 'utf-8');
  const routes = parseRoutes(hcl);

  it('declares a Lambda authorizer for the API', () => {
    // The inverse of every assertion below: "every route references an authorizer"
    // means nothing if no authorizer resource exists to reference.
    expect(hcl).toMatch(/resource\s+"aws_apigatewayv2_authorizer"\s+"service_token"/);
  });

  it('configures the authorizer as a REQUEST authorizer over the Authorization header', () => {
    const authorizer = /resource\s+"aws_apigatewayv2_authorizer"[\s\S]*?^\}/m.exec(hcl)?.[0] ?? '';

    expect(argument(authorizer, 'authorizer_type')).toBe('REQUEST');
    expect(argument(authorizer, 'authorizer_payload_format_version')).toBe('2.0');
    // Simple responses let the handler return `{ isAuthorized }` instead of hand-
    // rolling an IAM policy document — fewer ways to accidentally allow.
    expect(argument(authorizer, 'enable_simple_responses')).toBe('true');
    expect(authorizer).toContain('$request.header.Authorization');
  });

  it('parses the routes it claims to be checking', () => {
    // Without this, a regex that silently stops matching turns every `it.each`
    // below into zero test cases and the suite goes green on an open API.
    expect(routes.length).toBeGreaterThanOrEqual(8);
    expect(routes.every((route) => route.routeKey !== '')).toBe(true);
  });

  describe('every non-public route requires the authorizer', () => {
    const guarded = routes.filter((route) => !(route.routeKey in PUBLIC_ROUTES));

    it('leaves only the documented health probe public', () => {
      const publicRoutes = routes
        .filter((route) => route.routeKey in PUBLIC_ROUTES)
        .map((route) => route.routeKey);

      expect(publicRoutes).toEqual(Object.keys(PUBLIC_ROUTES));
    });

    it.each(guarded.map((route) => [route.routeKey, route] as const))(
      '%s is authorized',
      (_routeKey, route) => {
        expect(route.authorizationType).toBe('CUSTOM');
        expect(route.authorizerId).toBeDefined();
      }
    );

    it('covers every write route', () => {
      // #206's specific complaint. Named explicitly so that deleting the product
      // routes (rather than authorizing them) cannot satisfy this describe block.
      const writes = guarded
        .filter((route) => /^(POST|PUT|PATCH|DELETE)/.test(route.routeKey))
        .map((route) => route.routeKey)
        .sort();

      expect(writes).toEqual([
        'DELETE /api/products/{id}',
        'PATCH /api/products/{id}',
        'POST /api/products',
        'POST /api/products/{id}/sell',
        'PUT /api/products/{id}',
      ]);
    });
  });

  describe('the shared service token', () => {
    const variable = /variable\s+"api_service_token"\s*\{([\s\S]*?)^\}/m.exec(hcl)?.[1] ?? '';

    it('is declared sensitive', () => {
      expect(argument(variable, 'sensitive')).toBe('true');
    });

    it('has no default, so an apply cannot ship a known token', () => {
      // A default here would be a credential committed to git and shared by every
      // deploy — worse than the missing authorizer, because it would look solved.
      expect(argument(variable, 'default')).toBeUndefined();
    });
  });

  describe('scan coverage', () => {
    // The parser *is* the guard, so it gets fixtures of its own. These are written
    // out literally rather than derived from `main.tf`; a parser that reads its own
    // expectations out of the file under test cannot fail.
    const UNPROTECTED = [
      'resource "aws_apigatewayv2_route" "create_product" {',
      '  api_id    = aws_apigatewayv2_api.api.id',
      '  route_key = "POST /api/products"',
      '  target    = "integrations/${aws_apigatewayv2_integration.create_product.id}"',
      '}',
    ].join('\n');

    const PROTECTED = [
      'resource "aws_apigatewayv2_route" "create_product" {',
      '  api_id             = aws_apigatewayv2_api.api.id',
      '  route_key          = "POST /api/products"',
      '  target             = "integrations/${aws_apigatewayv2_integration.create_product.id}"',
      '  authorization_type = "CUSTOM"',
      '  authorizer_id      = aws_apigatewayv2_authorizer.service_token.id',
      '}',
    ].join('\n');

    it('flags a route declared with no authorization_type', () => {
      const [route] = parseRoutes(UNPROTECTED);

      expect(route.routeKey).toBe('POST /api/products');
      expect(route.authorizationType).toBeUndefined();
      expect(route.authorizerId).toBeUndefined();
    });

    it('accepts a route wired to the authorizer', () => {
      const [route] = parseRoutes(PROTECTED);

      expect(route.authorizationType).toBe('CUSTOM');
      expect(route.authorizerId).toBe('aws_apigatewayv2_authorizer.service_token.id');
    });

    it('finds every route in a multi-route document', () => {
      expect(parseRoutes([UNPROTECTED, PROTECTED].join('\n\n'))).toHaveLength(2);
    });
  });
});
