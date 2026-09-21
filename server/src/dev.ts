import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApp, parseOrigins } from "./app";
import { clock } from "./lib/clock";
import { getDb } from "./lib/db";
import { runTick } from "./services/tick";

// Local development server. Expo web runs on :8081 during development.
const port = Number(process.env.PORT ?? 3000);
const webOrigins = parseOrigins(process.env.WEB_ORIGINS ?? "http://localhost:8081,http://127.0.0.1:8081");
const app = createApp({ db: getDb, webOrigins });

// Listen on loopback only: one-tap dev login must not be reachable from the LAN.
// The tablet still reaches it through `adb reverse tcp:3000 tcp:3000` (which connects to 127.0.0.1).
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`MeritAI API listening on http://127.0.0.1:${info.port}/api`);
});

// The reminders tick (services/tick.ts) every 60 s in-process; production calls POST /api/internal/tick
// from a schedule instead. It uses the time machine's clock. A tick still running skips the next one.
const TICK_MS = 60_000;
let ticking = false;
const tick = async () => {
  if (ticking) return;
  ticking = true;
  try {
    const result = await runTick(getDb(), clock.now());
    const { now: _now, ...counts } = result;
    const done = Object.entries(counts).filter(([, n]) => n > 0);
    if (done.length > 0) console.log("tick:", Object.fromEntries(done));
  } catch (err) {
    console.error("tick failed", err);
  } finally {
    ticking = false;
  }
};
setInterval(tick, TICK_MS).unref();
setTimeout(tick, 5_000).unref();
