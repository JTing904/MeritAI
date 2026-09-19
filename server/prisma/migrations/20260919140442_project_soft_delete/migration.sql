-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityType" ADD VALUE 'PROJECT_DELETED';
ALTER TYPE "ActivityType" ADD VALUE 'PROJECT_RESTORED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_DELETED';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_RESTORED';

-- AlterEnum
ALTER TYPE "SwapVoidReason" ADD VALUE 'PROJECT_DELETED';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "purgeAfter" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Project_purgeAfter_idx" ON "Project"("purgeAfter");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
