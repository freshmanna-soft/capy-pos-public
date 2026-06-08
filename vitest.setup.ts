import { beforeAll, afterAll, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import 'fake-indexeddb/auto'; // Add this line

beforeAll(() => {
  // Initialize Angular TestBed for Vitest
  TestBed.initTestEnvironment(
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting(),
    {
      teardown: { destroyAfterEach: true }
    }
  );
});

afterEach(() => {
  // Cleanup after each test
  TestBed.resetTestingModule();
});

afterAll(() => {
  // Global teardown
  TestBed.resetTestEnvironment();
});

// Made with Bob
