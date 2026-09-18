import { createApp, parseOrigins } from "./app";
import { getDb } from "./lib/db";

// Entry point for Vercel (Hono is detected from the default export).
const app = createApp({ db: getDb, webOrigins: parseOrigins(process.env.WEB_ORIGINS) });

export default app;
