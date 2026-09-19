-- A21: Row Level Security on every table, with no policies.
--
-- Supabase's Data API (PostgREST, the anon / authenticated roles) can see tables in the public schema.
-- With RLS enabled and no policy, those roles get no rows at all. The app never uses the Data API: the
-- server connects as the table owner (Prisma), and an owner bypasses RLS unless FORCE is set, so
-- nothing changes for it. A role that is neither the owner nor BYPASSRLS would also see nothing.
--
-- Every later migration that creates a table must enable RLS on it too (tests/rls.test.ts checks).
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END $$;
