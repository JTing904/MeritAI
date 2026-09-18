import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7 reads the datasource URL from here, not from schema.prisma.
// Migrations need a direct (non-pooled) connection; locally DATABASE_URL is direct already.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: process.env.DIRECT_URL || process.env.DATABASE_URL },
});
