-- CreateEnum
CREATE TYPE "Grade" AS ENUM ('EXCELLENT', 'PASS', 'HALF', 'FAIL', 'SELF');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('DRAFT', 'PENDING', 'GRADED');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('FILE', 'LINK');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityType" ADD VALUE 'SUBMITTED';
ALTER TYPE "ActivityType" ADD VALUE 'WITHDRAWN';
ALTER TYPE "ActivityType" ADD VALUE 'GRADED';
ALTER TYPE "ActivityType" ADD VALUE 'OVERRIDDEN';
ALTER TYPE "ActivityType" ADD VALUE 'MEETING_DONE';
ALTER TYPE "ActivityType" ADD VALUE 'START_UNDONE';
ALTER TYPE "ActivityType" ADD VALUE 'PREREQ_SET';

-- AlterEnum
ALTER TYPE "NotificationAudience" ADD VALUE 'YOU_AND_LEADER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'GRADED';
ALTER TYPE "NotificationType" ADD VALUE 'GRADED_OUTSIDE';
ALTER TYPE "NotificationType" ADD VALUE 'OVERRIDDEN';
ALTER TYPE "NotificationType" ADD VALUE 'WAITING_ON_YOU';
ALTER TYPE "NotificationType" ADD VALUE 'PREREQ_DONE';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "briefExcerpt" TEXT,
ADD COLUMN     "briefFrom" INTEGER,
ADD COLUMN     "briefSplit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "briefTo" INTEGER,
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "grade" "Grade",
ADD COLUMN     "prereqTaskId" TEXT;

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "no" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "late" BOOLEAN NOT NULL DEFAULT false,
    "grade" "Grade",
    "gradeNote" TEXT,
    "gradedById" TEXT,
    "gradedAt" TIMESTAMP(3),
    "selfGraded" BOOLEAN NOT NULL DEFAULT false,
    "outsideApp" BOOLEAN NOT NULL DEFAULT false,
    "outsideNote" TEXT,
    "meetingSummary" TEXT,
    "attendeeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "absentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "storageKey" TEXT,
    "sizeBytes" INTEGER,
    "mimeType" TEXT,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeChange" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "fromGrade" "Grade" NOT NULL,
    "toGrade" "Grade" NOT NULL,
    "reason" TEXT NOT NULL,
    "byId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,

    CONSTRAINT "GradeChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attempt_taskId_status_idx" ON "Attempt"("taskId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_taskId_no_key" ON "Attempt"("taskId", "no");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_storageKey_key" ON "Evidence"("storageKey");

-- CreateIndex
CREATE INDEX "Evidence_taskId_idx" ON "Evidence"("taskId");

-- CreateIndex
CREATE INDEX "Evidence_attemptId_idx" ON "Evidence"("attemptId");

-- CreateIndex
CREATE INDEX "ChecklistItem_taskId_order_idx" ON "ChecklistItem"("taskId", "order");

-- CreateIndex
CREATE INDEX "GradeChange_attemptId_createdAt_idx" ON "GradeChange"("attemptId", "createdAt");

-- CreateIndex
CREATE INDEX "Task_prereqTaskId_idx" ON "Task"("prereqTaskId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_prereqTaskId_fkey" FOREIGN KEY ("prereqTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_gradedById_fkey" FOREIGN KEY ("gradedById") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeChange" ADD CONSTRAINT "GradeChange_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeChange" ADD CONSTRAINT "GradeChange_byId_fkey" FOREIGN KEY ("byId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data (M4 spec §3). Nothing was really reviewing before M4: those tasks go back to DOING.
UPDATE "Task" SET "status" = 'DOING' WHERE "status" = 'REVIEWING';
-- Grades move to the task (and its attempts). Enum literals need the cast: no assignment cast from text to "Grade".
UPDATE "Task" SET "grade" = (CASE "status" WHEN 'DONE' THEN 'PASS' WHEN 'HALF' THEN 'HALF' WHEN 'FAIL' THEN 'FAIL' END)::"Grade"
  WHERE "status" IN ('DONE', 'HALF', 'FAIL');
UPDATE "Task" SET "finishedAt" = "updatedAt" WHERE "grade" IN ('PASS', 'HALF');
-- One GRADED attempt per backfilled task, so override / best-grade / history logic sees the same shape as new data.
INSERT INTO "Attempt" ("id", "taskId", "no", "status", "grade", "outsideApp", "submittedAt", "gradedAt", "createdAt")
  SELECT gen_random_uuid()::text, "id", 1, 'GRADED', "grade", true, "updatedAt", "updatedAt", "updatedAt" FROM "Task" WHERE "grade" IS NOT NULL;
