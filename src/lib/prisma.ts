import "dotenv/config";
import { createRequire } from "module";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
let adapter: any = undefined;

const DEFAULT_DB_URL = "mysql://u394546085_hrrec:Hrrec2026Secure9@srv1824.hstgr.io:3306/u394546085_hrrec";
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
    const rawPassword = decodeURIComponent(connectionUrl.password);
    const password = (rawPassword === "48e65879a9574bfabdfbfa8e64c23f2b48e65879" || !rawPassword)
      ? "Hrrec2026Secure9"
      : rawPassword;

    const fs = require("fs");
    const possibleSockets = [
      "/var/lib/mysql/mysql.sock",
      "/var/run/mysqld/mysqld.sock",
      "/tmp/mysql.sock",
      "/var/run/mysql/mysql.sock"
    ];
    let detectedSocket: string | undefined = undefined;
    for (const sock of possibleSockets) {
      try {
        if (fs.existsSync(sock)) {
          detectedSocket = sock;
          break;
        }
      } catch {}
    }

    const adapterConfig: any = {
      user: decodeURIComponent(connectionUrl.username) || "u394546085_hrrec",
      password,
      database: decodeURIComponent(connectionUrl.pathname.replace(/^\//, "")) || "u394546085_hrrec",
      connectionLimit: 5,
      minimumIdle: 1,
      idleTimeout: 60,
      connectTimeout: 10_000,
      acquireTimeout: 15_000
    };

    if (detectedSocket) {
      adapterConfig.socketPath = detectedSocket;
    } else {
      adapterConfig.host = connectionUrl.hostname;
      adapterConfig.port = Number(connectionUrl.port || 3306);
    }

    adapter = new PrismaMariaDb(adapterConfig, {
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
  log: isDevelopment ? ["query", "error", "warn"] : ["error"]
});
