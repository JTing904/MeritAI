-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "blockedUntil" TIMESTAMP(3),

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "status" INTEGER,
    "body" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("userId","key")
);

-- CreateIndex
CREATE INDEX "IdempotencyKey_createdAt_idx" ON "IdempotencyKey"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_actorId_idx" ON "ActivityEvent"("actorId");

-- CreateIndex
CREATE INDEX "Attempt_submittedById_idx" ON "Attempt"("submittedById");

-- CreateIndex
CREATE INDEX "Attempt_gradedById_idx" ON "Attempt"("gradedById");

-- CreateIndex
CREATE INDEX "Evidence_addedById_idx" ON "Evidence"("addedById");

-- CreateIndex
CREATE INDEX "GradeChange_byId_idx" ON "GradeChange"("byId");

-- CreateIndex
CREATE INDEX "Invite_invitedById_idx" ON "Invite"("invitedById");

-- CreateIndex
CREATE INDEX "Notification_projectId_idx" ON "Notification"("projectId");

-- CreateIndex
CREATE INDEX "Notification_swapId_idx" ON "Notification"("swapId");

-- CreateIndex
CREATE INDEX "Project_deletedById_idx" ON "Project"("deletedById");

-- CreateIndex
CREATE INDEX "RetiredInviteCode_projectId_idx" ON "RetiredInviteCode"("projectId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "SwapRequest_requesterPackageId_idx" ON "SwapRequest"("requesterPackageId");

-- CreateIndex
CREATE INDEX "SwapRequest_targetPackageId_idx" ON "SwapRequest"("targetPackageId");

-- CreateIndex
CREATE INDEX "Task_startedById_idx" ON "Task"("startedById");

-- CreateIndex
CREATE INDEX "Task_featureId_idx" ON "Task"("featureId");

-- CreateIndex
CREATE INDEX "Task_milestoneId_idx" ON "Task"("milestoneId");

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
