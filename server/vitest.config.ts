import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    environment: "node",
    // Tests never talk to real outside services.
    env: { AI_PROVIDER: "none", DEV_LOGIN: "true" },
    // Database tests share one test database, so files run one at a time.
    fileParallelism: false,
  },
});
