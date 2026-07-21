import "dotenv/config";
import { createRequire } from "module";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
let adapter: any = undefined;

const databaseUrl = process.env.DATABASE_URL ?? "";

if (databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://")) {
  try {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const pg = require("pg");
    const pool = new pg.Pool({ connectionString: databaseUrl });
    adapter = new PrismaPg(pool);
  } catch (e) {
    console.warn("Failed to initialize Pg adapter", e);
  }
} else if (databaseUrl.startsWith("mariadb://") || databaseUrl.startsWith("mysql://")) {
  try {
    const { PrismaMariaDb } = require("@prisma/adapter-mariadb");
    const connectionUrl = new URL(databaseUrl);
    adapter = new PrismaMariaDb({
      host: connectionUrl.hostname,
      port: Number(connectionUrl.port || 3306),
      user: decodeURIComponent(connectionUrl.username),
      password: decodeURIComponent(connectionUrl.password),
      database: decodeURIComponent(connectionUrl.pathname.replace(/^\//, "")),
      connectionLimit: 3,
      minimumIdle: 1,
      idleTimeout: 60,
      connectTimeout: 10_000,
      acquireTimeout: 15_000
    }, {
      onConnectionError: (error: { code?: string; errno?: number; sqlState?: string }) => {
        console.error("MySQL connection failed", {
          code: error.code,
          errno: error.errno,
          sqlState: error.sqlState,
          host: connectionUrl.hostname,
          port: connectionUrl.port || "3306"
        });
      }
    });
  } catch (e) {
    console.warn("Failed to initialize MariaDB adapter", e);
  }
}

export const prisma = new PrismaClient({
  ...(adapter ? { adapter } : {}),
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"]
});
