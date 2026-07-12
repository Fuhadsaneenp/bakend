import "dotenv/config";
import { createRequire } from "module";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
let adapter: any = undefined;

const databaseUrl = process.env.DATABASE_URL ?? "";

if (databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://")) {
  const { PrismaPg } = require("@prisma/adapter-pg");
  const pg = require("pg");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  adapter = new PrismaPg(pool);
} else if (databaseUrl.startsWith("mariadb://") || databaseUrl.startsWith("mysql://")) {
  const { PrismaMariaDb } = require("@prisma/adapter-mariadb");
  adapter = new PrismaMariaDb(databaseUrl);
}

export const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"]
});
