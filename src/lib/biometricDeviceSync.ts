import { prisma } from "./prisma.js";

type SyncEmployee = {
  id: string;
  employeeCode: string;
  biometricId?: string | null;
  firstName: string;
  lastName: string;
  status?: string | null;
};

type TemplateArchiveRequest = {
  deviceSerialNumber: string;
  tableName: string;
  rawPayload: string;
};

const templateTablePatterns = [
  "FINGERTMP",
  "FP",
  "FACE",
  "BIOPHOTO",
  "TEMPLATE",
  "USERPIC",
  "BIOPHOTO"
];

function isPostgres() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  return databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://");
}

function escapeSqlString(value: string) {
  return value.replace(/'/g, "''");
}

function sanitizeEmployeeName(value: string) {
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, 24);
}

async function resolveTargetSerialNumber() {
  const configured = (process.env.ALLOWED_BIOMETRIC_SNS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length > 0) {
    return configured[0];
  }

  try {
    const rows = isPostgres()
      ? await prisma.$queryRawUnsafe<Array<{ deviceSerialNumber: string }>>(
          `SELECT "deviceSerialNumber"
           FROM "BiometricRawLog"
           WHERE "deviceSerialNumber" IS NOT NULL
             AND "deviceSerialNumber" <> ''
             AND "deviceSerialNumber" <> 'TEST123'
           ORDER BY "receivedAt" DESC
           LIMIT 1`
        )
      : await prisma.$queryRawUnsafe<Array<{ deviceSerialNumber: string }>>(
          `SELECT \`deviceSerialNumber\`
           FROM \`BiometricRawLog\`
           WHERE \`deviceSerialNumber\` IS NOT NULL
             AND \`deviceSerialNumber\` <> ''
             AND \`deviceSerialNumber\` <> 'TEST123'
           ORDER BY \`receivedAt\` DESC
           LIMIT 1`
        );

    return rows[0]?.deviceSerialNumber?.trim() || null;
  } catch (error) {
    console.error("[Biometric Sync] Failed to resolve target device serial number:", error);
    return null;
  }
}

function extractBiometricKey(employee: SyncEmployee) {
  return String(employee.biometricId || employee.employeeCode || "").trim();
}

function buildUserInfoCommand(employee: SyncEmployee, sequenceNumber: number) {
  const pin = extractBiometricKey(employee);
  const name = sanitizeEmployeeName(`${employee.firstName} ${employee.lastName}`.trim() || employee.employeeCode);
  const privilege = employee.status === "TERMINATED" || employee.status === "INACTIVE" ? 0 : 0;
  return `C:${sequenceNumber}:DATA UPDATE USERINFO PIN=${pin}\tName=${name}\tPri=${privilege}\tPasswd=\tCard=`;
}

function buildDeleteUserCommand(employee: SyncEmployee, sequenceNumber: number) {
  const pin = extractBiometricKey(employee);
  return `C:${sequenceNumber}:DATA DELETE USERINFO PIN=${pin}`;
}

function normalizeTemplateType(tableName: string) {
  return String(tableName || "").trim().toUpperCase();
}

function isTemplateTable(tableName: string) {
  const normalized = normalizeTemplateType(tableName);
  return templateTablePatterns.some((pattern) => normalized.includes(pattern));
}

function extractBiometricIdFromLine(line: string) {
  const pinMatch = line.match(/(?:USER\s+)?PIN=([^\t\r\n]+)/i);
  if (pinMatch?.[1]) return pinMatch[1].trim();
  const parts = line.split("\t");
  if (parts[0]?.trim()) return parts[0].trim();
  return null;
}

function extractFingerIndex(line: string) {
  const match = line.match(/(?:FID|FingerID)=([0-9]+)/i);
  return match?.[1] ? Number(match[1]) : null;
}

function extractTemplateBlob(line: string) {
  const tmpMatch = line.match(/(?:TMP|Template|FPTemplate)=([^\t\r\n]+)/i);
  if (tmpMatch?.[1]) return tmpMatch[1].trim();
  return line.trim();
}

async function fetchEmployeeIdByBiometricId(biometricId: string | null) {
  if (!biometricId) return null;
  const employee = await prisma.employee.findFirst({
    where: {
      OR: [
        { biometricId },
        { employeeCode: biometricId }
      ]
    },
    select: { id: true }
  });
  return employee?.id || null;
}

export async function ensureBiometricSyncSchema() {
  try {
    if (isPostgres()) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "BiometricDeviceCommand" (
          "id" SERIAL PRIMARY KEY,
          "deviceSerialNumber" TEXT NOT NULL,
          "employeeId" TEXT NULL,
          "commandType" TEXT NOT NULL,
          "commandPayload" TEXT NOT NULL,
          "processingStatus" TEXT NOT NULL DEFAULT 'QUEUED',
          "responsePayload" TEXT NULL,
          "errorMessage" TEXT NULL,
          "sentAt" TIMESTAMP(3) NULL,
          "acknowledgedAt" TIMESTAMP(3) NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "BiometricTemplateArchive" (
          "id" SERIAL PRIMARY KEY,
          "deviceSerialNumber" TEXT NOT NULL,
          "employeeId" TEXT NULL,
          "biometricId" TEXT NULL,
          "templateType" TEXT NOT NULL,
          "fingerIndex" INTEGER NULL,
          "sourceTable" TEXT NOT NULL,
          "templateData" TEXT NOT NULL,
          "rawPayload" TEXT NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      return;
    }

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`BiometricDeviceCommand\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`deviceSerialNumber\` VARCHAR(191) NOT NULL,
        \`employeeId\` VARCHAR(191) NULL,
        \`commandType\` VARCHAR(191) NOT NULL,
        \`commandPayload\` TEXT NOT NULL,
        \`processingStatus\` VARCHAR(191) NOT NULL DEFAULT 'QUEUED',
        \`responsePayload\` TEXT NULL,
        \`errorMessage\` TEXT NULL,
        \`sentAt\` DATETIME(3) NULL,
        \`acknowledgedAt\` DATETIME(3) NULL,
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`)
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS \`BiometricTemplateArchive\` (
        \`id\` INT NOT NULL AUTO_INCREMENT,
        \`deviceSerialNumber\` VARCHAR(191) NOT NULL,
        \`employeeId\` VARCHAR(191) NULL,
        \`biometricId\` VARCHAR(191) NULL,
        \`templateType\` VARCHAR(191) NOT NULL,
        \`fingerIndex\` INT NULL,
        \`sourceTable\` VARCHAR(191) NOT NULL,
        \`templateData\` TEXT NOT NULL,
        \`rawPayload\` LONGTEXT NOT NULL,
        \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`)
      )
    `);
  } catch (error) {
    console.error("[schema] Failed to ensure biometric sync tables:", error);
  }
}

export async function queueEmployeeDeviceSync(employee: SyncEmployee, commandType: "UPSERT_USER" | "DELETE_USER") {
  try {
    const pin = extractBiometricKey(employee);
    const serialNumber = await resolveTargetSerialNumber();
    if (!pin || !serialNumber) {
      return;
    }

    const nextIdRows = isPostgres()
      ? await prisma.$queryRawUnsafe<Array<{ next_id: number }>>(`SELECT COALESCE(MAX("id"), 0) + 1 AS next_id FROM "BiometricDeviceCommand"`)
      : await prisma.$queryRawUnsafe<Array<{ next_id: number }>>("SELECT COALESCE(MAX(`id`), 0) + 1 AS next_id FROM `BiometricDeviceCommand`");
    const sequenceNumber = Number(nextIdRows[0]?.next_id || 1);

    const payload = commandType === "DELETE_USER"
      ? buildDeleteUserCommand(employee, sequenceNumber)
      : buildUserInfoCommand(employee, sequenceNumber);

    if (isPostgres()) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "BiometricDeviceCommand"
          ("id", "deviceSerialNumber", "employeeId", "commandType", "commandPayload", "processingStatus", "createdAt", "updatedAt")
        VALUES
          (${sequenceNumber}, '${escapeSqlString(serialNumber)}', '${escapeSqlString(employee.id)}', '${escapeSqlString(commandType)}', '${escapeSqlString(payload)}', 'QUEUED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);
    } else {
      await prisma.$executeRawUnsafe(`
        INSERT INTO \`BiometricDeviceCommand\`
          (\`id\`, \`deviceSerialNumber\`, \`employeeId\`, \`commandType\`, \`commandPayload\`, \`processingStatus\`, \`createdAt\`, \`updatedAt\`)
        VALUES
          (${sequenceNumber}, '${escapeSqlString(serialNumber)}', '${escapeSqlString(employee.id)}', '${escapeSqlString(commandType)}', '${escapeSqlString(payload)}', 'QUEUED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
      `);
    }
  } catch (error) {
    console.error("[Biometric Sync] Failed to queue device command:", error);
  }
}

export async function queueEmployeeTemplateSync(employee: SyncEmployee) {
  try {
    const pin = extractBiometricKey(employee);
    const serialNumber = await resolveTargetSerialNumber();
    if (!pin || !serialNumber) return;

    const templates = isPostgres()
      ? await prisma.$queryRawUnsafe<Array<{ id: number; templateType: string; fingerIndex: number | null; templateData: string }>>(
          `SELECT "id", "templateType", "fingerIndex", "templateData"
           FROM "BiometricTemplateArchive"
           WHERE "biometricId" = '${escapeSqlString(pin)}'
           ORDER BY "id" ASC`
        )
      : await prisma.$queryRawUnsafe<Array<{ id: number; templateType: string; fingerIndex: number | null; templateData: string }>>(
          `SELECT \`id\`, \`templateType\`, \`fingerIndex\`, \`templateData\`
           FROM \`BiometricTemplateArchive\`
           WHERE \`biometricId\` = '${escapeSqlString(pin)}'
           ORDER BY \`id\` ASC`
        );

    for (const template of templates) {
      if (!normalizeTemplateType(template.templateType).includes("F")) continue;

      const nextIdRows = isPostgres()
        ? await prisma.$queryRawUnsafe<Array<{ next_id: number }>>(`SELECT COALESCE(MAX("id"), 0) + 1 AS next_id FROM "BiometricDeviceCommand"`)
        : await prisma.$queryRawUnsafe<Array<{ next_id: number }>>("SELECT COALESCE(MAX(`id`), 0) + 1 AS next_id FROM `BiometricDeviceCommand`");
      const sequenceNumber = Number(nextIdRows[0]?.next_id || 1);
      const payload = `C:${sequenceNumber}:DATA UPDATE FINGERTMP PIN=${pin}\tFID=${template.fingerIndex ?? 0}\tTMP=${template.templateData}`;

      if (isPostgres()) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "BiometricDeviceCommand"
            ("id", "deviceSerialNumber", "employeeId", "commandType", "commandPayload", "processingStatus", "createdAt", "updatedAt")
          VALUES
            (${sequenceNumber}, '${escapeSqlString(serialNumber)}', '${escapeSqlString(employee.id)}', 'UPSERT_TEMPLATE', '${escapeSqlString(payload)}', 'QUEUED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `);
      } else {
        await prisma.$executeRawUnsafe(`
          INSERT INTO \`BiometricDeviceCommand\`
            (\`id\`, \`deviceSerialNumber\`, \`employeeId\`, \`commandType\`, \`commandPayload\`, \`processingStatus\`, \`createdAt\`, \`updatedAt\`)
          VALUES
            (${sequenceNumber}, '${escapeSqlString(serialNumber)}', '${escapeSqlString(employee.id)}', 'UPSERT_TEMPLATE', '${escapeSqlString(payload)}', 'QUEUED', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
        `);
      }
    }
  } catch (error) {
    console.error("[Biometric Sync] Failed to queue template commands:", error);
  }
}

export async function getNextQueuedDeviceCommand(deviceSerialNumber: string) {
  try {
    const rows = isPostgres()
      ? await prisma.$queryRawUnsafe<Array<{ id: number; commandPayload: string }>>(
          `SELECT "id", "commandPayload"
           FROM "BiometricDeviceCommand"
           WHERE "deviceSerialNumber" = '${escapeSqlString(deviceSerialNumber)}'
             AND "processingStatus" = 'QUEUED'
           ORDER BY "id" ASC
           LIMIT 1`
        )
      : await prisma.$queryRawUnsafe<Array<{ id: number; commandPayload: string }>>(
          `SELECT \`id\`, \`commandPayload\`
           FROM \`BiometricDeviceCommand\`
           WHERE \`deviceSerialNumber\` = '${escapeSqlString(deviceSerialNumber)}'
             AND \`processingStatus\` = 'QUEUED'
           ORDER BY \`id\` ASC
           LIMIT 1`
        );

    const command = rows[0];
    if (!command) return null;

    if (isPostgres()) {
      await prisma.$executeRawUnsafe(`
        UPDATE "BiometricDeviceCommand"
        SET "processingStatus" = 'SENT',
            "sentAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${Number(command.id)}
      `);
    } else {
      await prisma.$executeRawUnsafe(`
        UPDATE \`BiometricDeviceCommand\`
        SET \`processingStatus\` = 'SENT',
            \`sentAt\` = CURRENT_TIMESTAMP(3),
            \`updatedAt\` = CURRENT_TIMESTAMP(3)
        WHERE \`id\` = ${Number(command.id)}
      `);
    }

    return command.commandPayload;
  } catch (error) {
    console.error("[Biometric Sync] Failed to fetch queued command:", error);
    return null;
  }
}

export async function acknowledgeDeviceCommand(deviceSerialNumber: string, responsePayload: string) {
  try {
    const idMatch = responsePayload.match(/(?:^|[\t\r\n ])(?:ID|C)=?[: ]?([0-9]+)/i) || responsePayload.match(/^C:([0-9]+)/i);
    const commandId = idMatch?.[1] ? Number(idMatch[1]) : null;
    const isSuccess = !/ERR|ERROR|FAIL/i.test(responsePayload);

    if (commandId) {
      if (isPostgres()) {
        await prisma.$executeRawUnsafe(`
          UPDATE "BiometricDeviceCommand"
          SET "processingStatus" = '${isSuccess ? "ACKNOWLEDGED" : "FAILED"}',
              "responsePayload" = '${escapeSqlString(responsePayload)}',
              "errorMessage" = ${isSuccess ? "NULL" : `'Device reported failure for command ${commandId}'`},
              "acknowledgedAt" = CURRENT_TIMESTAMP,
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${commandId}
            AND "deviceSerialNumber" = '${escapeSqlString(deviceSerialNumber)}'
        `);
      } else {
        await prisma.$executeRawUnsafe(`
          UPDATE \`BiometricDeviceCommand\`
          SET \`processingStatus\` = '${isSuccess ? "ACKNOWLEDGED" : "FAILED"}',
              \`responsePayload\` = '${escapeSqlString(responsePayload)}',
              \`errorMessage\` = ${isSuccess ? "NULL" : `'Device reported failure for command ${commandId}'`},
              \`acknowledgedAt\` = CURRENT_TIMESTAMP(3),
              \`updatedAt\` = CURRENT_TIMESTAMP(3)
          WHERE \`id\` = ${commandId}
            AND \`deviceSerialNumber\` = '${escapeSqlString(deviceSerialNumber)}'
        `);
      }
      return;
    }

    const fallbackRows = isPostgres()
      ? await prisma.$queryRawUnsafe<Array<{ id: number }>>(
          `SELECT "id"
           FROM "BiometricDeviceCommand"
           WHERE "deviceSerialNumber" = '${escapeSqlString(deviceSerialNumber)}'
             AND "processingStatus" = 'SENT'
           ORDER BY "id" DESC
           LIMIT 1`
        )
      : await prisma.$queryRawUnsafe<Array<{ id: number }>>(
          `SELECT \`id\`
           FROM \`BiometricDeviceCommand\`
           WHERE \`deviceSerialNumber\` = '${escapeSqlString(deviceSerialNumber)}'
             AND \`processingStatus\` = 'SENT'
           ORDER BY \`id\` DESC
           LIMIT 1`
        );

    const fallbackId = fallbackRows[0]?.id;
    if (!fallbackId) return;

    if (isPostgres()) {
      await prisma.$executeRawUnsafe(`
        UPDATE "BiometricDeviceCommand"
        SET "processingStatus" = '${isSuccess ? "ACKNOWLEDGED" : "FAILED"}',
            "responsePayload" = '${escapeSqlString(responsePayload)}',
            "errorMessage" = ${isSuccess ? "NULL" : "'Device reported failure without command id'"},
            "acknowledgedAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${Number(fallbackId)}
      `);
    } else {
      await prisma.$executeRawUnsafe(`
        UPDATE \`BiometricDeviceCommand\`
        SET \`processingStatus\` = '${isSuccess ? "ACKNOWLEDGED" : "FAILED"}',
            \`responsePayload\` = '${escapeSqlString(responsePayload)}',
            \`errorMessage\` = ${isSuccess ? "NULL" : "'Device reported failure without command id'"},
            \`acknowledgedAt\` = CURRENT_TIMESTAMP(3),
            \`updatedAt\` = CURRENT_TIMESTAMP(3)
        WHERE \`id\` = ${Number(fallbackId)}
      `);
    }
  } catch (error) {
    console.error("[Biometric Sync] Failed to acknowledge device command:", error);
  }
}

export async function archiveTemplatePayload(request: TemplateArchiveRequest) {
  try {
    if (!isTemplateTable(request.tableName) || !request.rawPayload.trim()) {
      return;
    }

    const lines = request.rawPayload.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const biometricId = extractBiometricIdFromLine(line);
      const employeeId = await fetchEmployeeIdByBiometricId(biometricId);
      const fingerIndex = extractFingerIndex(line);
      const templateData = extractTemplateBlob(line);
      const templateType = normalizeTemplateType(request.tableName);

      if (isPostgres()) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "BiometricTemplateArchive"
            ("deviceSerialNumber", "employeeId", "biometricId", "templateType", "fingerIndex", "sourceTable", "templateData", "rawPayload", "createdAt", "updatedAt")
          VALUES
            (
              '${escapeSqlString(request.deviceSerialNumber)}',
              ${employeeId ? `'${escapeSqlString(employeeId)}'` : "NULL"},
              ${biometricId ? `'${escapeSqlString(biometricId)}'` : "NULL"},
              '${escapeSqlString(templateType)}',
              ${fingerIndex ?? "NULL"},
              '${escapeSqlString(request.tableName)}',
              '${escapeSqlString(templateData)}',
              '${escapeSqlString(line)}',
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            )
        `);
      } else {
        await prisma.$executeRawUnsafe(`
          INSERT INTO \`BiometricTemplateArchive\`
            (\`deviceSerialNumber\`, \`employeeId\`, \`biometricId\`, \`templateType\`, \`fingerIndex\`, \`sourceTable\`, \`templateData\`, \`rawPayload\`, \`createdAt\`, \`updatedAt\`)
          VALUES
            (
              '${escapeSqlString(request.deviceSerialNumber)}',
              ${employeeId ? `'${escapeSqlString(employeeId)}'` : "NULL"},
              ${biometricId ? `'${escapeSqlString(biometricId)}'` : "NULL"},
              '${escapeSqlString(templateType)}',
              ${fingerIndex ?? "NULL"},
              '${escapeSqlString(request.tableName)}',
              '${escapeSqlString(templateData)}',
              '${escapeSqlString(line)}',
              CURRENT_TIMESTAMP(3),
              CURRENT_TIMESTAMP(3)
            )
        `);
      }
    }
  } catch (error) {
    console.error("[Biometric Sync] Failed to archive template payload:", error);
  }
}
