import { prisma } from "./prisma.js";

const shiftColumns = [
  {
    name: "workingDays",
    mysqlDefinition: "ADD COLUMN `workingDays` TEXT NULL",
    postgresDefinition: 'ADD COLUMN "workingDays" TEXT'
  },
  {
    name: "effectiveFrom",
    mysqlDefinition: "ADD COLUMN `effectiveFrom` DATETIME(3) NULL",
    postgresDefinition: 'ADD COLUMN "effectiveFrom" TIMESTAMP(3)'
  },
  {
    name: "scheduleType",
    mysqlDefinition: "ADD COLUMN `scheduleType` VARCHAR(191) NULL",
    postgresDefinition: 'ADD COLUMN "scheduleType" TEXT'
  },
  {
    name: "isDefault",
    mysqlDefinition: "ADD COLUMN `isDefault` BOOLEAN NULL",
    postgresDefinition: 'ADD COLUMN "isDefault" BOOLEAN'
  },
  {
    name: "isActive",
    mysqlDefinition: "ADD COLUMN `isActive` BOOLEAN NULL",
    postgresDefinition: 'ADD COLUMN "isActive" BOOLEAN'
  }
];

async function getExistingShiftColumns() {
  const databaseUrl = process.env.DATABASE_URL ?? "";

  if (databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://")) {
    const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'Shift'`
    );
    return new Set(rows.map((row) => row.column_name));
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'Shift'`
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function applyColumnDefaults() {
  const databaseUrl = process.env.DATABASE_URL ?? "";

  if (databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://")) {
    await prisma.$executeRawUnsafe(`UPDATE "Shift" SET "workingDays" = COALESCE("workingDays", '["Monday","Tuesday","Wednesday","Thursday","Friday"]')`);
    await prisma.$executeRawUnsafe(`UPDATE "Shift" SET "effectiveFrom" = COALESCE("effectiveFrom", CURRENT_TIMESTAMP)`);
    await prisma.$executeRawUnsafe(`UPDATE "Shift" SET "scheduleType" = COALESCE("scheduleType", 'Clock-based')`);
    await prisma.$executeRawUnsafe(`UPDATE "Shift" SET "isDefault" = COALESCE("isDefault", false)`);
    await prisma.$executeRawUnsafe(`UPDATE "Shift" SET "isActive" = COALESCE("isActive", true)`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Shift" ALTER COLUMN "workingDays" SET DEFAULT '["Monday","Tuesday","Wednesday","Thursday","Friday"]'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Shift" ALTER COLUMN "effectiveFrom" SET DEFAULT CURRENT_TIMESTAMP`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Shift" ALTER COLUMN "scheduleType" SET DEFAULT 'Clock-based'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Shift" ALTER COLUMN "isDefault" SET DEFAULT false`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Shift" ALTER COLUMN "isActive" SET DEFAULT true`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Shift" ALTER COLUMN "workingDays" SET NOT NULL`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Shift" ALTER COLUMN "effectiveFrom" SET NOT NULL`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Shift" ALTER COLUMN "scheduleType" SET NOT NULL`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Shift" ALTER COLUMN "isDefault" SET NOT NULL`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Shift" ALTER COLUMN "isActive" SET NOT NULL`);
    return;
  }

  await prisma.$executeRawUnsafe('UPDATE `Shift` SET `workingDays` = COALESCE(`workingDays`, \'["Monday","Tuesday","Wednesday","Thursday","Friday"]\')');
  await prisma.$executeRawUnsafe("UPDATE `Shift` SET `effectiveFrom` = COALESCE(`effectiveFrom`, CURRENT_TIMESTAMP(3))");
  await prisma.$executeRawUnsafe("UPDATE `Shift` SET `scheduleType` = COALESCE(`scheduleType`, 'Clock-based')");
  await prisma.$executeRawUnsafe("UPDATE `Shift` SET `isDefault` = COALESCE(`isDefault`, false)");
  await prisma.$executeRawUnsafe("UPDATE `Shift` SET `isActive` = COALESCE(`isActive`, true)");
  await prisma.$executeRawUnsafe("ALTER TABLE `Shift` MODIFY `workingDays` TEXT NOT NULL");
  await prisma.$executeRawUnsafe("ALTER TABLE `Shift` MODIFY `effectiveFrom` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)");
  await prisma.$executeRawUnsafe("ALTER TABLE `Shift` MODIFY `scheduleType` VARCHAR(191) NOT NULL DEFAULT 'Clock-based'");
  await prisma.$executeRawUnsafe("ALTER TABLE `Shift` MODIFY `isDefault` BOOLEAN NOT NULL DEFAULT false");
  await prisma.$executeRawUnsafe("ALTER TABLE `Shift` MODIFY `isActive` BOOLEAN NOT NULL DEFAULT true");
}

export async function ensureShiftSchema() {
  try {
    const existingColumns = await getExistingShiftColumns();
    const databaseUrl = process.env.DATABASE_URL ?? "";
    const isPostgres = databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://");

    for (const column of shiftColumns) {
      if (existingColumns.has(column.name)) continue;
      const sql = isPostgres
        ? `ALTER TABLE "Shift" ${column.postgresDefinition}`
        : `ALTER TABLE \`Shift\` ${column.mysqlDefinition}`;
      await prisma.$executeRawUnsafe(sql);
      console.log(`[schema] Added missing Shift.${column.name} column`);
    }

    await applyColumnDefaults();
  } catch (error) {
    console.error("[schema] Failed to ensure Shift table schema:", error);
  }
}
