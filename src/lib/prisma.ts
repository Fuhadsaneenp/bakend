import "dotenv/config";
import { createRequire } from "module";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
let adapter: any = undefined;

const DEFAULT_DB_URL = "mysql://u394546085_hrrec:48e65879a9574bfabdfbfa8e64c23f2b48e65879@srv1824.hstgr.io:3306/u394546085_stems_db";
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = DEFAULT_DB_URL;
}
const databaseUrl = process.env.DATABASE_URL;
const isDevelopment = process.env.NODE_ENV !== "production";

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
      connectionLimit: 5,
      minimumIdle: 1,
      idleTimeout: 60,
      connectTimeout: isDevelopment ? 5_000 : 15_000,
      acquireTimeout: isDevelopment ? 5_000 : 20_000
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
  datasourceUrl: databaseUrl,
  log: isDevelopment ? ["query", "error", "warn"] : ["error"]
} as any);
