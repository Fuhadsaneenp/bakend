import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

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

export const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: normalizePostgresUrl(process.env.DATABASE_URL ?? "")
  }),
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"]
});
