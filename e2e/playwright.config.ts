// End-to-end journeys against the local stack (e2e/stack/start.sh).
// Run everything with `npm run test:e2e` (repo root) or `bash e2e/run.sh`.
import { defineConfig, devices } from "@playwright/test";
import { stack } from "./tests/support/stack";

const CI = !!process.env.CI;

// The app URL of the running stack; a placeholder when none is running (for
// `playwright show-report` / `--list`): global-setup then explains how to start it.
function appUrl(): string {
  try {
    return stack().APP_URL;
  } catch {
    return "http://127.0.0.1:8340";
  }
}

export default defineConfig({
  testDir: "./tests",
  outputDir: "./artifacts/test-results",
  globalSetup: "./tests/global-setup.ts",
  // One worker: the journeys share one vite dev server, whose on-demand
  // compilation is the bottleneck, and each journey drives several people.
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 180_000,
  // Dev-mode compilation on a cold CI runner can be slow: more patience there.
  expect: { timeout: CI ? 30_000 : 20_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "./artifacts/html-report", open: "never" }],
    ["junit", { outputFile: "./artifacts/junit.xml" }],
    ...(CI ? ([["github"]] as const) : []),
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: appUrl(),
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
    viewport: { width: 1440, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 90_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
