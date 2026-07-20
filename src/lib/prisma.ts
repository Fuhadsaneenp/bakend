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
  const connectionUrl = new URL(databaseUrl);
  adapter = new PrismaMariaDb({
    host: connectionUrl.hostname,
    port: Number(connectionUrl.port || 3306),
    user: decodeURIComponent(connectionUrl.username),
    password: decodeURIComponent(connectionUrl.password),
    database: decodeURIComponent(connectionUrl.pathname.replace(/^\//, "")),
    // Hostinger shared MySQL has a small per-user connection allowance. The
    // MariaDB driver otherwise pre-opens `connectionLimit` idle connections,
    // which can lock this app out of its own database after a redeploy.
    connectionLimit: 3,
    minimumIdle: 1,
    idleTimeout: 60,
    connectTimeout: 10_000,
    acquireTimeout: 15_000
  }, {
    onConnectionError: (error: { code?: string; errno?: number; sqlState?: string }) => {
      // Never log the connection URL or credentials.
      console.error("MySQL connection failed", {
        code: error.code,
        errno: error.errno,
        sqlState: error.sqlState,
        host: connectionUrl.hostname,
        port: connectionUrl.port || "3306"
      });
    }
  });
}

export const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"]
});
