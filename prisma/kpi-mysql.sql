-- AlterTable
ALTER TABLE `WorkCard` ADD COLUMN `completedAt` DATETIME(3) NULL,
    ADD COLUMN `workQuantity` DOUBLE NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE `KpiConfiguration` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `weights` JSON NOT NULL,
    `levels` JSON NOT NULL,
    `maxOutputScore` DOUBLE NOT NULL DEFAULT 110,
    `minimumActiveRatio` DOUBLE NOT NULL DEFAULT 0.6,
    `ruleDefaultsVersion` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `KpiConfiguration_companyId_key`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KpiWorkUnitRule` (
    `id` VARCHAR(191) NOT NULL,
    `configurationId` VARCHAR(191) NOT NULL,
    `taskType` VARCHAR(191) NOT NULL,
    `quantity` DOUBLE NOT NULL DEFAULT 1,
    `workUnits` DOUBLE NOT NULL,

    UNIQUE INDEX `KpiWorkUnitRule_configurationId_taskType_key`(`configurationId`, `taskType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KpiTarget` (
    `id` VARCHAR(191) NOT NULL,
    `configurationId` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(191) NOT NULL,
    `scopeId` VARCHAR(191) NULL,
    `dailyWorkUnits` DOUBLE NOT NULL,
    `expectedMinutes` INTEGER NOT NULL DEFAULT 480,

    UNIQUE INDEX `KpiTarget_configurationId_scope_scopeId_key`(`configurationId`, `scope`, `scopeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KpiActivity` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `workDate` DATETIME(3) NOT NULL,
    `activeMinutes` INTEGER NOT NULL DEFAULT 0,
    `idleMinutes` INTEGER NOT NULL DEFAULT 0,
    `breakMinutes` INTEGER NOT NULL DEFAULT 0,
    `firstActivityAt` DATETIME(3) NULL,
    `lastActivityAt` DATETIME(3) NULL,
    `validEntries` INTEGER NOT NULL DEFAULT 0,
    `incorrectEntries` INTEGER NOT NULL DEFAULT 0,
    `duplicateEntries` INTEGER NOT NULL DEFAULT 0,
    `rejectedItems` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `KpiActivity_companyId_workDate_idx`(`companyId`, `workDate`),
    UNIQUE INDEX `KpiActivity_employeeId_workDate_key`(`employeeId`, `workDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KpiLeave` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `halfDay` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `KpiLeave_companyId_employeeId_startDate_endDate_idx`(`companyId`, `employeeId`, `startDate`, `endDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmployeeKpiSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `attendanceScore` DOUBLE NOT NULL,
    `activeWorkScore` DOUBLE NULL,
    `outputScore` DOUBLE NOT NULL,
    `qualityScore` DOUBLE NULL,
    `efficiencyScore` DOUBLE NULL,
    `reliabilityScore` DOUBLE NOT NULL,
    `workUnits` DOUBLE NOT NULL,
    `finalKpiScore` DOUBLE NOT NULL,
    `breakdown` JSON NOT NULL,
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmployeeKpiSnapshot_companyId_period_periodStart_idx`(`companyId`, `period`, `periodStart`),
    UNIQUE INDEX `EmployeeKpiSnapshot_employeeId_period_periodStart_key`(`employeeId`, `period`, `periodStart`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `KpiConfiguration` ADD CONSTRAINT `KpiConfiguration_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KpiWorkUnitRule` ADD CONSTRAINT `KpiWorkUnitRule_configurationId_fkey` FOREIGN KEY (`configurationId`) REFERENCES `KpiConfiguration`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KpiTarget` ADD CONSTRAINT `KpiTarget_configurationId_fkey` FOREIGN KEY (`configurationId`) REFERENCES `KpiConfiguration`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KpiActivity` ADD CONSTRAINT `KpiActivity_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KpiActivity` ADD CONSTRAINT `KpiActivity_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KpiLeave` ADD CONSTRAINT `KpiLeave_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KpiLeave` ADD CONSTRAINT `KpiLeave_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmployeeKpiSnapshot` ADD CONSTRAINT `EmployeeKpiSnapshot_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

