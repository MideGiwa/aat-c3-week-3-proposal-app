import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Loads DATABASE_URL from the environment (.env.local in dev). Run
// `npm run db:push` to sync this schema to your Postgres database, or
// `npm run db:generate` to emit SQL migration files instead.
export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
});
