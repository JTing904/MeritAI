-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- Hardening B2: conditional GETs hash Project.version into their ETag, so it must move on EVERY write
-- that can change what a project's members see. Triggers instead of app code: no write path (today's or
-- a future one, raw SQL or cascade) can forget it. Statement-level triggers with transition tables bump
-- each touched project once per statement (a bulk updateMany over 300 tasks is one UPDATE of the project).
-- Every app write already locks the project row first (services/tx.ts lockProject), so the extra UPDATE
-- takes no lock the transaction doesn't already hold. Prisma doesn't manage triggers: later migrations
-- leave them alone.

-- 1. Any UPDATE of the project row itself (Prisma writes, the bumps below) moves the version.
CREATE FUNCTION "cache_project_row_bump"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."version" := OLD."version" + 1;
  RETURN NEW;
END $$;

CREATE TRIGGER "Project_cache_version" BEFORE UPDATE ON "Project"
  FOR EACH ROW EXECUTE FUNCTION "cache_project_row_bump"();

-- 2. Rows with a "projectId" column.
CREATE FUNCTION "cache_bump_by_project"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "Project" SET "version" = "version" + 1 WHERE "id" IN (SELECT "projectId" FROM new_rows);
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE "Project" SET "version" = "version" + 1 WHERE "id" IN (SELECT "projectId" FROM old_rows);
  ELSE
    UPDATE "Project" SET "version" = "version" + 1
      WHERE "id" IN (SELECT "projectId" FROM new_rows UNION SELECT "projectId" FROM old_rows);
  END IF;
  RETURN NULL;
END $$;

-- 3. Rows with a "taskId" column (the task's project).
CREATE FUNCTION "cache_bump_by_task"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "Project" SET "version" = "version" + 1
      WHERE "id" IN (SELECT t."projectId" FROM "Task" t WHERE t."id" IN (SELECT "taskId" FROM new_rows));
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE "Project" SET "version" = "version" + 1
      WHERE "id" IN (SELECT t."projectId" FROM "Task" t WHERE t."id" IN (SELECT "taskId" FROM old_rows));
  ELSE
    UPDATE "Project" SET "version" = "version" + 1
      WHERE "id" IN (SELECT t."projectId" FROM "Task" t
                     WHERE t."id" IN (SELECT "taskId" FROM new_rows UNION SELECT "taskId" FROM old_rows));
  END IF;
  RETURN NULL;
END $$;

-- 4. Rows with an "attemptId" column (the attempt's task's project).
CREATE FUNCTION "cache_bump_by_attempt"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "Project" SET "version" = "version" + 1
      WHERE "id" IN (SELECT t."projectId" FROM "Attempt" a JOIN "Task" t ON t."id" = a."taskId"
                     WHERE a."id" IN (SELECT "attemptId" FROM new_rows));
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE "Project" SET "version" = "version" + 1
      WHERE "id" IN (SELECT t."projectId" FROM "Attempt" a JOIN "Task" t ON t."id" = a."taskId"
                     WHERE a."id" IN (SELECT "attemptId" FROM old_rows));
  ELSE
    UPDATE "Project" SET "version" = "version" + 1
      WHERE "id" IN (SELECT t."projectId" FROM "Attempt" a JOIN "Task" t ON t."id" = a."taskId"
                     WHERE a."id" IN (SELECT "attemptId" FROM new_rows UNION SELECT "attemptId" FROM old_rows));
  END IF;
  RETURN NULL;
END $$;

-- A trigger with transition tables takes one event, so each table gets three.
DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('Member', 'cache_bump_by_project'),
      ('Package', 'cache_bump_by_project'),
      ('Feature', 'cache_bump_by_project'),
      ('Milestone', 'cache_bump_by_project'),
      ('Task', 'cache_bump_by_project'),
      ('Invite', 'cache_bump_by_project'),
      ('SwapRequest', 'cache_bump_by_project'),
      ('Attempt', 'cache_bump_by_task'),
      ('Evidence', 'cache_bump_by_task'),
      ('ChecklistItem', 'cache_bump_by_task'),
      ('GradeChange', 'cache_bump_by_attempt')
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

-- 5. A person's name shows in every project they are (or were) in: member lists, owners, inviters.
CREATE FUNCTION "cache_bump_by_user_name"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Project" SET "version" = "version" + 1
    WHERE "id" IN (SELECT m."projectId" FROM "Member" m WHERE m."userId" = NEW."id");
  RETURN NULL;
END $$;

CREATE TRIGGER "User_cache_name" AFTER UPDATE OF "name" ON "User"
  FOR EACH ROW WHEN (OLD."name" IS DISTINCT FROM NEW."name") EXECUTE FUNCTION "cache_bump_by_user_name"();
