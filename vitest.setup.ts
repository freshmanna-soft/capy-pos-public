import { beforeAll, afterAll, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';

/**
 * Real WebCrypto in the test environment.
 *
 * jsdom ships `crypto.getRandomValues` but no `crypto.subtle`, and a growing
 * number of modules genuinely need it — PBKDF2 for password and PIN hashing,
 * ECDSA/RSA verification for passkey assertions, SHA-256 for the WebAuthn
 * relying-party hash. Faking `subtle` would make those tests assert against the
 * fake; Node's implementation is the same primitive set the browser gives us, so
 * the specs exercise the real thing.
 *
 * `subtle` is patched onto jsdom's existing crypto object rather than replacing
 * it, so anything relying on jsdom's own `getRandomValues` keeps working.
 */
if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
} else if (typeof globalThis.crypto.subtle === 'undefined') {
  Object.defineProperty(globalThis.crypto, 'subtle', {
    value: webcrypto.subtle,
    configurable: true,
  });
}

beforeAll(() => {
  TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting(), {
    teardown: { destroyAfterEach: true },
  });
});

afterEach(async () => {
  // Root-cause fix for cross-spec flakes (#109 contract gate, #112 teardown noise):
  // some component specs kick off an async ngOnInit chain (e.g. load products) and
  // finish assertions before it settles. Under --coverage's slower timing the
  // dangling promise rejects/logs AFTER teardown and lands in the NEXT spec's
  // window. Draining the macro/microtask queue here forces that late work to run
  // inside the spec that started it, so async side-effects never leak across
  // spec boundaries. One 0ms tick per spec.
  await new Promise((resolve) => setTimeout(resolve, 0));
  TestBed.resetTestingModule();
});

afterAll(() => {
  TestBed.resetTestEnvironment();
});
