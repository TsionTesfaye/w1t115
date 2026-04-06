import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * jsdom gives us DOMParser, document.createElement, and Web Crypto API
     * so service tests can exercise sanitization and crypto utilities without
     * a real browser.
     *
     * singleThread: true — prevents parallel spec files from racing on
     * TestBed.initTestEnvironment(), which can only be called once per
     * JS environment. Angular component specs each call initTestEnvironment
     * in beforeAll; they must run sequentially in a single thread.
     */
    environment: 'jsdom',
    include: [
      'src/**/*.spec.ts',
      'unit_tests/**/*.spec.ts',
      'API_tests/**/*.spec.ts',
      'browser_tests/**/*.spec.ts',
      'e2e_tests/**/*.spec.ts',
    ],
    setupFiles: ['src/test-setup.ts'],
    singleThread: true,
  },
});
