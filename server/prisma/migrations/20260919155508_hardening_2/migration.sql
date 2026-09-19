-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "briefBytes" INTEGER;

-- Existing briefs: their size.
UPDATE "Project" SET "briefBytes" = octet_length("briefText") WHERE "briefText" IS NOT NULL;
