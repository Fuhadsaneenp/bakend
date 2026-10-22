-- CreateTable
CREATE TABLE `SeoWorkspace` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NULL,
    `sourceSiteUrl` VARCHAR(512) NULL,
    `lastSyncAttemptAt` DATETIME(3) NULL,
    `lastSyncAt` DATETIME(3) NULL,
    `nextSyncAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leaseUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SeoWorkspace_clientId_key`(`clientId`),
    INDEX `SeoWorkspace_companyId_nextSyncAt_idx`(`companyId`, `nextSyncAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SeoMember` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'EMPLOYEE',

    INDEX `SeoMember_employeeId_idx`(`employeeId`),
    UNIQUE INDEX `SeoMember_workspaceId_employeeId_key`(`workspaceId`, `employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SeoConnection` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `ownerUserId` VARCHAR(191) NOT NULL,
    `refreshCipher` TEXT NOT NULL,
    `accessCipher` TEXT NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'CONNECTED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SeoConnection_companyId_ownerUserId_idx`(`companyId`, `ownerUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SeoOAuthState` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `verifierCipher` TEXT NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SeoProperty` (
    `id` VARCHAR(191) NOT NULL,
    `connectionId` VARCHAR(191) NOT NULL,
    `siteUrl` VARCHAR(512) NOT NULL,
    `permissionLevel` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `SeoProperty_connectionId_siteUrl_key`(`connectionId`, `siteUrl`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SeoMetric` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `dimension` VARCHAR(191) NOT NULL,
    `keyHash` VARCHAR(64) NOT NULL,
    `label` TEXT NOT NULL,
    `clicks` DOUBLE NOT NULL,
    `impressions` DOUBLE NOT NULL,
    `ctr` DOUBLE NOT NULL,
    `position` DOUBLE NOT NULL,
    `preliminary` BOOLEAN NOT NULL DEFAULT false,
    `fetchedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SeoMetric_workspaceId_dimension_date_idx`(`workspaceId`, `dimension`, `date`),
    UNIQUE INDEX `SeoMetric_workspaceId_date_dimension_keyHash_key`(`workspaceId`, `date`, `dimension`, `keyHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SeoKeyword` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `keyword` VARCHAR(512) NOT NULL,
    `targetUrl` TEXT NOT NULL,
    `country` VARCHAR(191) NOT NULL DEFAULT '',
    `device` VARCHAR(191) NOT NULL DEFAULT '',
    `intent` VARCHAR(191) NOT NULL DEFAULT '',
    `employeeId` VARCHAR(191) NULL,
    `identityHash` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SeoKeyword_workspaceId_identityHash_key`(`workspaceId`, `identityHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SeoRanking` (
    `id` VARCHAR(191) NOT NULL,
    `keywordId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `position` DOUBLE NULL,
    `clicks` DOUBLE NULL,
    `impressions` DOUBLE NULL,
    `ctr` DOUBLE NULL,

    UNIQUE INDEX `SeoRanking_keywordId_date_source_key`(`keywordId`, `date`, `source`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SeoTask` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `workCardId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `project` VARCHAR(191) NOT NULL DEFAULT '',
    `assignedDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startTime` DATETIME(3) NULL,
    `completionTime` DATETIME(3) NULL,
    `targetQuantity` DOUBLE NOT NULL,
    `completedQuantity` DOUBLE NOT NULL DEFAULT 0,
    `remarks` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ASSIGNED',
    `feedback` TEXT NULL,
    `quality` INTEGER NULL,
    `points` DOUBLE NOT NULL DEFAULT 0,
    `approvedEvidenceHash` VARCHAR(64) NULL,
    `ledgerId` VARCHAR(191) NULL,

    UNIQUE INDEX `SeoTask_workCardId_key`(`workCardId`),
    UNIQUE INDEX `SeoTask_ledgerId_key`(`ledgerId`),
    INDEX `SeoTask_workspaceId_employeeId_status_idx`(`workspaceId`, `employeeId`, `status`),
    UNIQUE INDEX `SeoTask_workspaceId_category_approvedEvidenceHash_key`(`workspaceId`, `category`, `approvedEvidenceHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SeoEvidence` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NULL,
    `fileData` LONGBLOB NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SeoReview` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SeoPointRule` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `points` DOUBLE NOT NULL,

    UNIQUE INDEX `SeoPointRule_companyId_category_key`(`companyId`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SeoActivity` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PLANNED',
    `verification` VARCHAR(191) NOT NULL DEFAULT 'UNVERIFIED',
    `verifiedAt` DATETIME(3) NULL,
    `data` JSON NOT NULL,
    `history` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SeoActivity_workspaceId_kind_status_idx`(`workspaceId`, `kind`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SeoReport` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `month` VARCHAR(191) NOT NULL,
    `snapshot` JSON NOT NULL,
    `summary` TEXT NULL,
    `generatedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SeoReport_workspaceId_month_key`(`workspaceId`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SeoSyncLog` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `rows` INTEGER NOT NULL DEFAULT 0,
    `details` TEXT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    INDEX `SeoSyncLog_workspaceId_startedAt_idx`(`workspaceId`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SeoLegacySheet` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `sheetKey` VARCHAR(191) NOT NULL,
    `sourceHash` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `importedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SeoLegacySheet_workspaceId_sourceHash_key`(`workspaceId`, `sourceHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SeoWorkspace` ADD CONSTRAINT `SeoWorkspace_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeoWorkspace` ADD CONSTRAINT `SeoWorkspace_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `SeoProperty`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeoMember` ADD CONSTRAINT `SeoMember_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `SeoWorkspace`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeoMember` ADD CONSTRAINT `SeoMember_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeoProperty` ADD CONSTRAINT `SeoProperty_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `SeoConnection`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeoMetric` ADD CONSTRAINT `SeoMetric_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `SeoWorkspace`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeoKeyword` ADD CONSTRAINT `SeoKeyword_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `SeoWorkspace`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeoRanking` ADD CONSTRAINT `SeoRanking_keywordId_fkey` FOREIGN KEY (`keywordId`) REFERENCES `SeoKeyword`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeoTask` ADD CONSTRAINT `SeoTask_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `SeoWorkspace`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeoTask` ADD CONSTRAINT `SeoTask_workCardId_fkey` FOREIGN KEY (`workCardId`) REFERENCES `WorkCard`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeoEvidence` ADD CONSTRAINT `SeoEvidence_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `SeoTask`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeoReview` ADD CONSTRAINT `SeoReview_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `SeoTask`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeoActivity` ADD CONSTRAINT `SeoActivity_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `SeoWorkspace`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeoReport` ADD CONSTRAINT `SeoReport_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `SeoWorkspace`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeoSyncLog` ADD CONSTRAINT `SeoSyncLog_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `SeoWorkspace`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeoLegacySheet` ADD CONSTRAINT `SeoLegacySheet_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `SeoWorkspace`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

