import { beforeAll, afterAll, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import 'fake-indexeddb/auto';

beforeAll(() => {
  TestBed.initTestEnvironment(
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting(),
    {
      teardown: { destroyAfterEach: true }
    }
  );
});

afterEach(() => {
  TestBed.resetTestingModule();
});

afterAll(() => {
  TestBed.resetTestEnvironment();
});
