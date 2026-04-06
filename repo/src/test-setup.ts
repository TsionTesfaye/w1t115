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
import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
