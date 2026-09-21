-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityType" ADD VALUE 'PROJECT_ENDED';
ALTER TYPE "ActivityType" ADD VALUE 'PROJECT_REOPENED';
ALTER TYPE "ActivityType" ADD VALUE 'TASK_DELAYED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'TASK_DUE_SOON';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_DUE_REVIEW';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_OWNERLESS_SOON';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_OVERDUE';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_OWNERLESS_OVERDUE';
ALTER TYPE "NotificationType" ADD VALUE 'PREREQ_BLOCKED';
ALTER TYPE "NotificationType" ADD VALUE 'WEEKLY_SUMMARY';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_AUTO_END_SOON';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_ENDED';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_REOPENED';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_DELETE_SOON';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_DELAYED';

-- AlterEnum
ALTER TYPE "SwapVoidReason" ADD VALUE 'PROJECT_ENDED';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "awaitingSince" TIMESTAMP(3),
ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "endedAuto" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "endedById" TEXT;

-- CreateTable
CREATE TABLE "ReminderLog" (
    "key" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ReminderLog_projectId_idx" ON "ReminderLog"("projectId");

-- CreateIndex
CREATE INDEX "Project_endedById_idx" ON "Project"("endedById");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A21: every new table gets Row Level Security (no policies; see migration enable_rls).
ALTER TABLE "ReminderLog" ENABLE ROW LEVEL SECURITY;

-- Rows from before M5 (set by hand or tests): give them the lifecycle fields the tick relies on.
UPDATE "Project" SET "awaitingSince" = "deadline" WHERE "status" = 'AWAITING_CONFIRM' AND "awaitingSince" IS NULL;
UPDATE "Project" SET "endedAt" = "updatedAt", "purgeAfter" = coalesce("purgeAfter", "updatedAt" + interval '14 days')
  WHERE "status" = 'ENDED' AND "endedAt" IS NULL;
