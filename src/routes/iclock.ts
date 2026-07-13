import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";

export const iclockRouter = Router();

// Helper: Extract serial number from request case-insensitively
function getDeviceSerialNumber(req: any): string {
  const query = req.query || {};
  const sn = query.SN || query.sn || query.Sn || query.sN || "";
  return sn.toString().trim();
}

// Helper: Extract table name from request case-insensitively
function getTableName(req: any): string {
  const query = req.query || {};
  const table = query.table || query.TABLE || query.Table || "";
  return table.toString().trim();
}

// Helper: Clean sensitive headers to prevent logging passwords/cookies/tokens
function getCleanedHeaders(headers: any): any {
  const cleaned = { ...headers };
  const sensitive = ["authorization", "cookie", "set-cookie", "x-api-key", "proxy-authorization", "password", "pwd"];
  for (const key of Object.keys(cleaned)) {
    if (sensitive.includes(key.toLowerCase())) {
      delete cleaned[key];
    }
  }
  return cleaned;
}

// 1. Raw body parsing middleware (limit body size to 2MB)
function parseRawBody(req: any, res: any, next: any) {
  let data = "";
  const limitBytes = 2 * 1024 * 1024; // 2MB limit
  let bytesReceived = 0;
  let limitExceeded = false;

  req.setEncoding("utf8");
  req.on("data", (chunk: string) => {
    if (limitExceeded) return;
    bytesReceived += Buffer.byteLength(chunk, "utf8");
    if (bytesReceived > limitBytes) {
      limitExceeded = true;
      res.status(413).type("text/plain").send("Payload Too Large");
      req.destroy();
      return;
    }
    data += chunk;
  });
  req.on("end", () => {
    if (limitExceeded) return;
    req.rawBody = data;
    next();
  });
  req.on("error", (err: any) => {
    if (limitExceeded) return;
    next(err);
  });
}

// 2. Security: Validate SN parameter
const allowedSnsStr = env.ALLOWED_BIOMETRIC_SNS || "";
const allowedSns = allowedSnsStr
  .split(",")
  .map((s: string) => s.trim())
  .filter(Boolean);

function validateDeviceSn(req: any, res: any, next: any) {
  const sn = getDeviceSerialNumber(req);
  if (!sn) {
    return res.status(400).type("text/plain").send("ERROR: Missing SN");
  }

  // Always allow TEST123 for initial discovery/testing
  if (sn === "TEST123") {
    return next();
  }

  // Enforce allowed list if defined in env
  if (allowedSns.length > 0 && !allowedSns.includes(sn)) {
    console.warn(`[Biometric] Blocked unauthorized device SN: ${sn}`);
    return res.status(403).type("text/plain").send("ERROR: Unauthorized SN");
  }

  next();
}

// 3. Security: Controlled rate limiter (60 requests per min)
const biometricRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: "ERROR: Rate limit exceeded",
  handler: (req, res, next, options) => {
    res.status(options.statusCode).type("text/plain").send(options.message);
  }
});

// Helper: safe console logger for development/diagnostics (Requirement 2)
function logBiometricToConsole(req: any) {
  const sn = getDeviceSerialNumber(req);
  const tableName = getTableName(req);
  const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  const cleanedHeaders = getCleanedHeaders(req.headers);

  console.log(`[BIOMETRIC REQUEST] [${new Date().toISOString()}]`);
  console.log(`- Method: ${req.method}`);
  console.log(`- Full URL: ${fullUrl}`);
  console.log(`- SN: ${sn}`);
  console.log(`- Table: ${tableName}`);
  console.log(`- Query: ${JSON.stringify(req.query)}`);
  console.log(`- Headers: ${JSON.stringify(cleanedHeaders)}`);
  console.log(`- Raw Body:\n${req.rawBody || "(empty)"}`);
  console.log("----------------------------------------");
}

// Helper: safe database logger (Requirement 5)
async function logBiometricToDb(req: any, status: string, error?: string) {
  const sn = getDeviceSerialNumber(req) || "UNKNOWN_SN";
  const cleanedHeaders = getCleanedHeaders(req.headers);

  try {
    await prisma.biometricRawLog.create({
      data: {
        deviceSerialNumber: sn,
        requestMethod: req.method,
        requestPath: req.path,
        queryParameters: JSON.stringify(req.query),
        headers: JSON.stringify(cleanedHeaders),
        rawPayload: req.rawBody || "",
        processingStatus: status,
        errorMessage: error || null
      }
    });
  } catch (err: any) {
    console.error("Failed to write biometric raw log to DB:", err);
  }
}

// Apply common middlewares to all routes under /iclock
iclockRouter.use(parseRawBody);
iclockRouter.use(validateDeviceSn);
iclockRouter.use(biometricRateLimiter);

// 4. Endpoints
// GET /iclock/cdata - Configuration options response (Requirement 6)
iclockRouter.get("/cdata", async (req, res) => {
  logBiometricToConsole(req);
  await logBiometricToDb(req, "PROCESSED");

  const sn = getDeviceSerialNumber(req) || "TEST123";
  const configResponse = [
    `GET OPTION FROM: ${sn}`,
    "Stamp=999999",
    "OpStamp=999999",
    "PhotoStamp=999999",
    "ErrorDelay=60",
    "Delay=30",
    "TransTimes=00:00;14:00",
    "TransInterval=1",
    "TransFlag=1000000000",
    "Realtime=1",
    "Encrypt=0"
  ].join("\r\n");

  res.type("text/plain").send(configResponse);
});

// POST /iclock/cdata - Accept device uploads (Requirement 7)
iclockRouter.post("/cdata", async (req, res) => {
  logBiometricToConsole(req);
  // Mark as PENDING since parsing is not yet implemented (Requirement 17)
  await logBiometricToDb(req, "PENDING");

  res.type("text/plain").send("OK");
});

// GET /iclock/getrequest - Fetch commands queue (Requirement 8)
iclockRouter.get("/getrequest", async (req, res) => {
  logBiometricToConsole(req);
  await logBiometricToDb(req, "PROCESSED");

  res.type("text/plain").send("OK");
});

// POST /iclock/devicecmd - Acknowledge command execution (Requirement 9)
iclockRouter.post("/devicecmd", async (req, res) => {
  logBiometricToConsole(req);
  await logBiometricToDb(req, "PROCESSED");

  res.type("text/plain").send("OK");
});
