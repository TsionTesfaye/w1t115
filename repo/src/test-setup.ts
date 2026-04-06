/**
 * Vitest setup file — loaded before all tests.
 *
 * Imports the Angular JIT compiler so that TestBed, provideRouter, and other
 * Angular testing utilities can compile partially-linked library code at runtime.
 * Without this import, tests that use @angular/core/testing or
 * @angular/platform-browser/testing will fail with a JIT compilation error.
 *
 * TestBed.initTestEnvironment() is called once here so that component spec
 * files do not each have to call it in a beforeAll(). Calling it multiple
 * times in the same process throws "Cannot set base providers because it has
 * already been called". Individual spec files only need resetTestingModule()
 * in afterEach() to isolate tests from each other.
 */
import 'zone.js';
import 'zone.js/testing';
import { webcrypto } from 'node:crypto';

// Node 18 + jsdom: crypto.subtle is not exposed in the jsdom global by default.
// Wire in Node's built-in Web Crypto so all crypto.subtle calls work in tests.
if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  });
}
import { getTestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';

getTestBed().initTestEnvironment(
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting(),
);

// jsdom does not implement URL.createObjectURL / revokeObjectURL.
// Stub them so tests can use vi.spyOn() on these methods without throwing.
if (typeof URL.createObjectURL === 'undefined') {
  Object.defineProperty(URL, 'createObjectURL', {
    value: () => 'blob:stub',
    writable: true,
    configurable: true,
  });
}
if (typeof URL.revokeObjectURL === 'undefined') {
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: () => {},
    writable: true,
    configurable: true,
  });
}
