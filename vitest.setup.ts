import { beforeAll, afterAll, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import 'fake-indexeddb/auto';

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
