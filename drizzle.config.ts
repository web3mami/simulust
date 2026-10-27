import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: process.env.DATABASE_URL ? { url: process.env.DATABASE_URL } : { url: "postgres://localhost/simulust" },
});
