-- CreateTable
CREATE TABLE `IncentivePolicy` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `effectiveFrom` VARCHAR(10) NOT NULL,
    `config` JSON NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IncentivePolicy_companyId_effectiveFrom_createdAt_idx`(`companyId`, `effectiveFrom`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IncentiveCredit` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `sourceKey` VARCHAR(191) NOT NULL,
    `sourceUrl` TEXT NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `day` VARCHAR(10) NOT NULL,
    `month` VARCHAR(7) NOT NULL,
    `policyId` VARCHAR(191) NULL,
    `snapshot` JSON NOT NULL,
    `calculation` JSON NOT NULL,
    `verification` JSON NULL,
    `standardMinutes` DOUBLE NOT NULL DEFAULT 0,
    `creditedMinutes` DOUBLE NOT NULL DEFAULT 0,
    `estimatedCents` INTEGER NOT NULL DEFAULT 0,
    `approvedCents` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    `revision` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `IncentiveCredit_companyId_month_employeeId_idx`(`companyId`, `month`, `employeeId`),
    UNIQUE INDEX `IncentiveCredit_companyId_sourceKey_key`(`companyId`, `sourceKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IncentiveAudit` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `creditId` VARCHAR(191) NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `detail` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IncentiveAudit_companyId_createdAt_idx`(`companyId`, `createdAt`),
    INDEX `IncentiveAudit_creditId_createdAt_idx`(`creditId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

