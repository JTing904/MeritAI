import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApp, parseOrigins } from "./app";
import { getDb } from "./lib/db";

// Local development server. Expo web runs on :8081 during development.
const port = Number(process.env.PORT ?? 3000);
const webOrigins = parseOrigins(process.env.WEB_ORIGINS ?? "http://localhost:8081,http://127.0.0.1:8081");
const app = createApp({ db: getDb, webOrigins });

// Listen on loopback only: one-tap dev login must not be reachable from the LAN.
// The tablet still reaches it through `adb reverse tcp:3000 tcp:3000` (which connects to 127.0.0.1).
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`MeritAI API listening on http://127.0.0.1:${info.port}/api`);
});
