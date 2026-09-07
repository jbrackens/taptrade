import { defineConfig, devices } from "@playwright/test";
import path from "path";

/**
 * Comprehensive Playwright E2E Config
 *
 * Tests both the Tap Trade Player App and the office Backoffice
 *
 * Run all tests:     npx playwright test
 * Run player app:    npx playwright test --project=player-app
 * Run backoffice:    npx playwright test --project=backoffice
 * Run with UI:       npx playwright test --ui
 * Debug mode:        npx playwright test --debug
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/*.spec.ts"],
  fullyParallel: false, // sequential to maintain state consistency
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ["html", { open: "never" }],
    ["junit", { outputFile: "./test-results/junit.xml" }],
    ["list"],
  ],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },

  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    // ============================================
    // BACKOFFICE (OFFICE) - Admin Interface
    // ============================================
    {
      name: "backoffice",
      testDir: "./e2e/backoffice",
      testMatch: "**/*.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:3000",
        viewport: { width: 1920, height: 1080 },
      },
      dependencies: ["backoffice-auth"],
    },

    {
      name: "backoffice-auth",
      testMatch: "auth.setup.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:3000",
      },
    },

    // ============================================
    // PLAYER APP - Sports Betting Application
    // ============================================
    {
      name: "player-app",
      testDir: "./e2e/player-app",
      testMatch: "**/*.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:3002",
        viewport: { width: 1280, height: 720 },
      },
    },

    // ============================================
    // RESPONSIVE TESTS
    // ============================================
    {
      name: "player-app-mobile",
      testDir: "./e2e/player-app",
      testMatch: "responsive.spec.ts",
      use: {
        ...devices["iPhone 12"],
        baseURL: "http://localhost:3002",
        viewport: { width: 390, height: 844 },
      },
    },

    {
      name: "player-app-tablet",
      testDir: "./e2e/player-app",
      testMatch: "responsive.spec.ts",
      use: {
        ...devices["iPad Pro"],
        baseURL: "http://localhost:3002",
        viewport: { width: 1024, height: 1366 },
      },
    },
  ],

  /* Start dev servers before tests */
  webServer: [
    {
      command: "cd packages/mock-server && npm run run-local:dev",
      port: 3010,
      timeout: 30_000,
      reuseExistingServer: true,
      env: {
        NODE_ENV: "test",
      },
    },
    {
      command: "cd packages/office && yarn run-local:dev",
      port: 3000,
      timeout: 60_000,
      reuseExistingServer: true,
      env: {
        API_GLOBAL_ENDPOINT: "http://localhost:3010",
        WS_GLOBAL_ENDPOINT: "ws://localhost:3010",
        NODE_ENV: "test",
      },
    },
    {
      command: "cd packages/app && yarn run-local:dev",
      port: 3002,
      timeout: 60_000,
      reuseExistingServer: true,
      env: {
        NEXT_PUBLIC_API_ENDPOINT: "http://localhost:18080",
        NEXT_PUBLIC_AUTH_ENDPOINT: "http://localhost:18081",
        NEXT_PUBLIC_WS_ENDPOINT: "ws://localhost:18080",
        NODE_ENV: "test",
      },
    },
  ],
});
