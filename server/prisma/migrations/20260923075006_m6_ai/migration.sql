-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('GEMINI', 'CLAUDE', 'OPENAI');

-- CreateEnum
CREATE TYPE "AiKeyStatus" AS ENUM ('OK', 'INVALID', 'QUOTA');

-- CreateEnum
CREATE TYPE "AiState" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AiJobKind" AS ENUM ('BRIEF', 'HOWTO', 'GRADE');

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ChoiceType" AS ENUM ('PICK_N', 'METHOD');

-- CreateEnum
CREATE TYPE "AiLevel" AS ENUM ('LOW', 'MID', 'HIGH');

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'CHOICE_CHANGED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'AI_REVIEW_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'AI_KEY_PROBLEM';
ALTER TYPE "NotificationType" ADD VALUE 'CHOICE_CHANGED';

-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "aiFailReason" TEXT,
ADD COLUMN     "aiModel" TEXT,
ADD COLUMN     "aiProvider" "AiProvider",
ADD COLUMN     "aiReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "aiState" "AiState",
ADD COLUMN     "aiSuggestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "gradedByAi" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "briefFileKey" TEXT,
ADD COLUMN     "briefFileMime" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "checklistByAi" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "choiceOptionId" TEXT,
ADD COLUMN     "howto" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "howtoByAi" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "aiAdultConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "aiKeyCheckedAt" TIMESTAMP(3),
ADD COLUMN     "aiKeyCipher" TEXT,
ADD COLUMN     "aiKeyLast4" TEXT,
ADD COLUMN     "aiKeyNotice" TEXT,
ADD COLUMN     "aiKeyStatus" "AiKeyStatus",
ADD COLUMN     "aiProvider" "AiProvider";

-- CreateTable
CREATE TABLE "AiUsage" (
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("userId","day","tier")
);

-- CreateTable
CREATE TABLE "AiJob" (
    "id" TEXT NOT NULL,
    "kind" "AiJobKind" NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "attemptId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'QUEUED',
    "tries" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "error" TEXT,
    "payload" JSONB,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChoiceQuestion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "quote" TEXT,
    "type" "ChoiceType" NOT NULL,
    "pickCount" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "ChoiceQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChoiceOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "material" "AiLevel" NOT NULL,
    "difficulty" "AiLevel" NOT NULL,
    "pros" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "picked" BOOLEAN NOT NULL DEFAULT false,
    "tasksJson" JSONB NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "ChoiceOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiJob_dedupeKey_key" ON "AiJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "AiJob_status_runAfter_idx" ON "AiJob"("status", "runAfter");

-- CreateIndex
CREATE INDEX "AiJob_projectId_kind_createdAt_idx" ON "AiJob"("projectId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "AiJob_taskId_idx" ON "AiJob"("taskId");

-- CreateIndex
CREATE INDEX "ChoiceQuestion_projectId_idx" ON "ChoiceQuestion"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ChoiceOption_questionId_key_key" ON "ChoiceOption"("questionId", "key");

-- CreateIndex
CREATE INDEX "Task_choiceOptionId_idx" ON "Task"("choiceOptionId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_choiceOptionId_fkey" FOREIGN KEY ("choiceOptionId") REFERENCES "ChoiceOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChoiceQuestion" ADD CONSTRAINT "ChoiceQuestion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChoiceOption" ADD CONSTRAINT "ChoiceOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ChoiceQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A21: every new table gets Row Level Security (no policies; see migration enable_rls).
ALTER TABLE "AiUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChoiceQuestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChoiceOption" ENABLE ROW LEVEL SECURITY;

-- Cache versions (migration cache_versions): AI results land in project-owned rows, so the conditional GETs
-- must see them. AiJob (the wizard's analysis progress, 今天审核了几次) and ChoiceQuestion carry a projectId;
-- ChoiceOption belongs to a question. AiUsage is per account: GET /api/me hashes the usage itself.
CREATE FUNCTION "cache_bump_by_question"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "Project" SET "version" = "version" + 1
      WHERE "id" IN (SELECT q."projectId" FROM "ChoiceQuestion" q WHERE q."id" IN (SELECT "questionId" FROM new_rows));
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE "Project" SET "version" = "version" + 1
      WHERE "id" IN (SELECT q."projectId" FROM "ChoiceQuestion" q WHERE q."id" IN (SELECT "questionId" FROM old_rows));
  ELSE
    UPDATE "Project" SET "version" = "version" + 1
      WHERE "id" IN (SELECT q."projectId" FROM "ChoiceQuestion" q
                     WHERE q."id" IN (SELECT "questionId" FROM new_rows UNION SELECT "questionId" FROM old_rows));
  END IF;
  RETURN NULL;
END $$;

DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('AiJob', 'cache_bump_by_project'),
      ('ChoiceQuestion', 'cache_bump_by_project'),
      ('ChoiceOption', 'cache_bump_by_question')
    ) AS s(tbl, fn)
  LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows
                    FOR EACH STATEMENT EXECUTE FUNCTION %I()', spec.tbl || '_cache_ins', spec.tbl, spec.fn);
    EXECUTE format('CREATE TRIGGER %I AFTER UPDATE ON %I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
                    FOR EACH STATEMENT EXECUTE FUNCTION %I()', spec.tbl || '_cache_upd', spec.tbl, spec.fn);
    EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows
                    FOR EACH STATEMENT EXECUTE FUNCTION %I()', spec.tbl || '_cache_del', spec.tbl, spec.fn);
  END LOOP;
END $$;

-- The leader's key shows in every project they lead (ProjectView.ai: provider, configured, status), so a
-- change to it moves those projects' versions (every project the user is in: the same cheap bump as a name change).
CREATE TRIGGER "User_cache_ai" AFTER UPDATE OF "aiProvider", "aiKeyStatus", "aiKeyCipher" ON "User"
  FOR EACH ROW WHEN (OLD."aiProvider" IS DISTINCT FROM NEW."aiProvider"
                     OR OLD."aiKeyStatus" IS DISTINCT FROM NEW."aiKeyStatus"
                     OR OLD."aiKeyCipher" IS DISTINCT FROM NEW."aiKeyCipher")
  EXECUTE FUNCTION "cache_bump_by_user_name"();
