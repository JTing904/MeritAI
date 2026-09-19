import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    environment: "node",
    // Tests never talk to real outside services. vitest applies `env` after the shell environment, so
    // UPLOAD_DIR falls back here only when unset: parallel suites each pass their own (.uploads-test-<role>).
    env: {
      AI_PROVIDER: "none",
      DEV_LOGIN: "true",
      // Dev login also needs an explicit development environment (lib/dev-gate.ts).
      APP_ENV: "development",
      UPLOAD_DIR: process.env.UPLOAD_DIR ?? ".uploads-test",
      PUBLIC_API_URL: "http://test.local",
      AUTH_SECRET: "test-secret",
      STORAGE_DRIVER: "local",
    },
    // Database tests share one test database, so files run one at a time.
    fileParallelism: false,
  },
});
