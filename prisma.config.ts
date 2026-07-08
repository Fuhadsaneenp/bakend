import "dotenv/config";
import { defineConfig, env } from "prisma/config";

function normalizePostgresUrl(value: string) {
  const url = new URL(value);

  if (url.protocol === "mysql:") {
    url.protocol = "postgresql:";
  }

  if (url.hostname === "127.0.0.1" && url.port === "3306") {
    url.port = "5432";
  }

  return url.toString();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: normalizePostgresUrl(env("DATABASE_URL"))
  },
  migrations: {
    seed: "tsx prisma/seed.ts"
  }
});
