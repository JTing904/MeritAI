-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'TASKS_RESPLIT';

-- AlterEnum
ALTER TYPE "AiJobKind" ADD VALUE 'RESPLIT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'AI_RESPLIT_READY';
ALTER TYPE "NotificationType" ADD VALUE 'AI_RESPLIT_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'TASKS_RESPLIT';
