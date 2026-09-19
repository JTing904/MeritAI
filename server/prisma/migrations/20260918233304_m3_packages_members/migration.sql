-- CreateEnum
CREATE TYPE "SwapStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED', 'VOID');

-- CreateEnum
CREATE TYPE "SwapVoidReason" AS ENUM ('SWITCHED', 'STARTED', 'SWAPPED_ELSEWHERE', 'LEFT', 'RESPLIT');

-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('GROUP', 'ONLY_YOU', 'ONLY_LEADER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SWAP_REQUEST', 'SWAP_ACCEPTED', 'SWAP_DECLINED', 'SWAP_EXPIRED', 'SWAP_VOID', 'MEMBER_NEEDS_PACKAGE', 'MEMBER_LEFT', 'MEMBER_REMOVED', 'REMOVED_YOU', 'TASK_ADDED', 'TASK_MOVED_IN', 'TASK_MOVED_OUT', 'RESPLIT', 'PACKAGE_ASSIGNED', 'LEADER_TRANSFERRED');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('PLAN_CONFIRMED', 'JOINED', 'LEFT', 'REMOVED', 'PICKED', 'SWITCHED', 'SWAPPED', 'ASSIGNED', 'TASK_ADDED', 'TASK_MOVED', 'TASK_STARTED', 'RESPLIT', 'LEADER_TRANSFERRED');

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "packageReminderAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "packagesVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "leaderDueAt" TIMESTAMP(3),
ADD COLUMN     "startedById" TEXT;

-- CreateTable
CREATE TABLE "SwapRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "requesterPackageId" TEXT,
    "targetPackageId" TEXT,
    "status" "SwapStatus" NOT NULL DEFAULT 'PENDING',
    "voidReason" "SwapVoidReason",
    "voidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "SwapRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "type" "NotificationType" NOT NULL,
    "audience" "NotificationAudience",
    "mine" BOOLEAN NOT NULL DEFAULT true,
    "payload" JSONB NOT NULL,
    "swapId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "ActivityType" NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SwapRequest_projectId_status_idx" ON "SwapRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "SwapRequest_requesterId_status_idx" ON "SwapRequest"("requesterId", "status");

-- CreateIndex
CREATE INDEX "SwapRequest_targetId_status_idx" ON "SwapRequest"("targetId", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_id_idx" ON "Notification"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_projectId_createdAt_id_idx" ON "ActivityEvent"("projectId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapRequest" ADD CONSTRAINT "SwapRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapRequest" ADD CONSTRAINT "SwapRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapRequest" ADD CONSTRAINT "SwapRequest_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapRequest" ADD CONSTRAINT "SwapRequest_requesterPackageId_fkey" FOREIGN KEY ("requesterPackageId") REFERENCES "Package"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapRequest" ADD CONSTRAINT "SwapRequest_targetPackageId_fkey" FOREIGN KEY ("targetPackageId") REFERENCES "Package"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_swapId_fkey" FOREIGN KEY ("swapId") REFERENCES "SwapRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: due dates the leader set by hand (they differ from what the planner suggested) become leaderDueAt.
UPDATE "Task" SET "leaderDueAt" = "dueAt"
WHERE "dueAt" IS NOT NULL AND ("suggestedDueAt" IS NULL OR "dueAt" <> "suggestedDueAt");
