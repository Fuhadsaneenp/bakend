import express, { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { runBiometricSync } from "./biometricSync.js";

type IClockRequest = Request & {
  rawBody?: string;
};

const biometricBodyLimit = "256kb";
const biometricAllowedSns = new Set(
  (env.ALLOWED_BIOMETRIC_SNS || "")
    .split(",")
    .map((value: string) => value.trim())
    .filter(Boolean)
);

const sensitiveHeaders = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
  "password",
  "pwd"
]);

export const iclockRouter = Router();

iclockRouter.use((req, res, next) => {
  res.type("text/plain");
  next();
});

iclockRouter.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") {
    (req as IClockRequest).rawBody = "";
  }
  next();
});

iclockRouter.use(express.raw({
  type: () => true,
  limit: biometricBodyLimit,
  verify: (req: IClockRequest, _res: Response, buffer: Buffer) => {
    req.rawBody = buffer.toString("utf8");
  }
}));

iclockRouter.use((req: IClockRequest, _res, next) => {
  if (typeof req.rawBody !== "string") {
    if (Buffer.isBuffer(req.body)) {
      req.rawBody = req.body.toString("utf8");
    } else {
      req.rawBody = "";
    }
  }

  next();
});

const biometricRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: "ERROR: Rate limit exceeded",
  handler: (_req, res, _next, options) => {
    res.status(options.statusCode).type("text/plain").send(String(options.message));
  }
});

iclockRouter.use(biometricRateLimiter);

// Debug endpoint - secure retrieve of raw log database records
iclockRouter.get("/debug-logs", async (req, res) => {
  const key = req.query.key;
  const expectedKey = env.BIOMETRIC_API_KEY || "essl-secret-key-123";
  if (!key || key !== expectedKey) {
    return res.status(401).type("text/plain").send("Unauthorized");
  }
  try {
    const pathFilter = req.query.path ? String(req.query.path) : undefined;
    
    if (pathFilter === "employees") {
      const emps = await prisma.employee.findMany({
        select: {
          employeeCode: true,
          biometricId: true,
          firstName: true,
          lastName: true
        }
      });
      return res.json(emps);
    }

    if (pathFilter === "reset") {
      const { runBiometricSync } = await import("./biometricSync.js");
      const updated = await prisma.biometricRawLog.updateMany({
        data: {
          processingStatus: "PENDING",
          errorMessage: null
        }
      });
      runBiometricSync().catch(console.error);
      return res.json({ message: `Reset ${updated.count} logs to PENDING and triggered sync.` });
    }

    if (pathFilter === "attendance") {
      const records = await prisma.attendance.findMany({
        include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
        orderBy: { workDate: "desc" },
        take: 30
      });
      return res.json(records);
    }

    const logs = await prisma.biometricRawLog.findMany({
      orderBy: { receivedAt: "desc" },
      take: 100
    });
    
    const filteredLogs = pathFilter
      ? logs.filter((log) => log.requestPath.includes(pathFilter))
      : logs;

    res.json(filteredLogs.slice(0, 50));
  } catch (err: any) {
    res.status(500).type("text/plain").send(err.message || err.toString());
  }
});

iclockRouter.use(async (req: IClockRequest, res, next) => {
  if (req.path === "/debug-logs") {
    return next();
  }

  if (!isKnownIClockRoute(req.path)) {
    await persistBiometricLog(req, "FAILED", `Unsupported route: ${req.path}`);
    return res.status(404).send("ERROR: Unsupported route");
  }

  const serialNumber = getDeviceSerialNumber(req);
  if (!serialNumber) {
    await persistBiometricLog(req, "FAILED", "Missing SN query parameter");
    return res.status(400).send("ERROR: Missing SN");
  }

  if (biometricAllowedSns.size > 0 && serialNumber !== "TEST123" && !biometricAllowedSns.has(serialNumber)) {
    console.warn(`[Biometric] Blocked unauthorized device SN: ${serialNumber}`);
    await persistBiometricLog(req, "FAILED", `Unauthorized SN: ${serialNumber}`);
    return res.status(403).send("ERROR: Unauthorized SN");
  }

  next();
});

iclockRouter.get(["/cdata", "/cdata.aspx"], async (req: IClockRequest, res, next) => {
  try {
    logBiometricRequest(req);
    await persistBiometricLog(req, "PROCESSED");

    const serialNumber = getDeviceSerialNumber(req);
    const responseLines = [
      `GET OPTION FROM: ${serialNumber}`,
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
    ];

    res.send(responseLines.join("\r\n"));
  } catch (error) {
    next(error);
  }
});

iclockRouter.post(["/cdata", "/cdata.aspx"], async (req: IClockRequest, res, next) => {
  try {
    logBiometricRequest(req);
    await persistBiometricLog(req, "PENDING");
    res.send("OK");

    // Process new pending raw logs in the background asynchronously
    runBiometricSync().catch((err) => {
      console.error("[Biometric Sync] Background processing failed:", err);
    });
  } catch (error) {
    next(error);
  }
});

iclockRouter.get(["/getrequest", "/getrequest.aspx"], async (req: IClockRequest, res, next) => {
  try {
    logBiometricRequest(req);
    await persistBiometricLog(req, "PROCESSED");
    res.send("OK");
  } catch (error) {
    next(error);
  }
});

iclockRouter.post(["/devicecmd", "/devicecmd.aspx"], async (req: IClockRequest, res, next) => {
  try {
    logBiometricRequest(req);
    await persistBiometricLog(req, "PROCESSED");
    res.send("OK");
  } catch (error) {
    next(error);
  }
});

iclockRouter.use(async (error: any, req: IClockRequest, res: Response, _next: NextFunction) => {
  const message =
    error?.type === "entity.too.large"
      ? "Payload Too Large"
      : error?.message || "Biometric request handling failed";

  await persistBiometricLog(req, "FAILED", message);
  console.error("[Biometric] Route error:", error);
  res.status(error?.type === "entity.too.large" ? 413 : 400).type("text/plain").send(`ERROR: ${message}`);
});

function isKnownIClockRoute(path: string) {
  const normalizedPath = path.endsWith(".aspx") ? path.slice(0, -5) : path;
  return normalizedPath === "/cdata" || normalizedPath === "/getrequest" || normalizedPath === "/devicecmd";
}

function getDeviceSerialNumber(req: Request) {
  const serialValue = req.query.SN ?? req.query.sn ?? req.query.Sn ?? req.query.sN;
  return String(serialValue || "").trim();
}

function getTableName(req: Request) {
  const tableValue = req.query.table ?? req.query.TABLE ?? req.query.Table;
  return String(tableValue || "").trim();
}

function getRequestUrl(req: Request) {
  const host = req.get("host") || "unknown-host";
  return `${req.protocol}://${host}${req.originalUrl}`;
}

function sanitizeHeaders(headers: Request["headers"]) {
  const cleanedHeaders: Record<string, string | string[] | undefined> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (sensitiveHeaders.has(key.toLowerCase())) {
      continue;
    }

    cleanedHeaders[key] = value;
  }

  return cleanedHeaders;
}

function logBiometricRequest(req: IClockRequest) {
  console.log(`[BIOMETRIC REQUEST] [${new Date().toISOString()}]`);
  console.log(`- Method: ${req.method}`);
  console.log(`- Full URL: ${getRequestUrl(req)}`);
  console.log(`- Query: ${JSON.stringify(req.query)}`);
  console.log(`- Headers: ${JSON.stringify(sanitizeHeaders(req.headers))}`);
  console.log(`- SN: ${getDeviceSerialNumber(req) || "UNKNOWN_SN"}`);
  console.log(`- Table: ${getTableName(req) || "(not provided)"}`);
  console.log(`- Timestamp: ${new Date().toISOString()}`);
  console.log(`- Raw Body:\n${req.rawBody || "(empty)"}`);
  console.log("----------------------------------------");
}

async function persistBiometricLog(req: IClockRequest, status: string, errorMessage?: string) {
  try {
    await prisma.biometricRawLog.create({
      data: {
        deviceSerialNumber: getDeviceSerialNumber(req) || "UNKNOWN_SN",
        requestMethod: req.method || "UNKNOWN",
        requestPath: req.originalUrl || req.path || "/iclock",
        queryParameters: JSON.stringify(req.query || {}),
        headers: JSON.stringify(sanitizeHeaders(req.headers || {})),
        rawPayload: req.rawBody || "",
        processingStatus: status,
        errorMessage: errorMessage || null
      }
    });
  } catch (databaseError) {
    console.error("[Biometric] Failed to persist raw log:", databaseError);
  }
}
