import "dotenv/config";
import { execSync } from "node:child_process";

// Bring the separate test database up to the latest migrations before any test runs.
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: "" },
  });
}
