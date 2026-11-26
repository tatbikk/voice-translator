-- Review of the IR-11 fix (decision 76): the query of a list reads every
-- condition of an awaited act from the data the file's snapshot reads it from,
-- so that «ينتظر إجراء مني» counts only the files where an act awaits.
--
-- 1. The facts of an investigation are those of the file's latest one. A query
--    cannot say «the latest» of a file's rows: the database marks it. The mark
--    is derived, never written by the application: a row is inserted unmarked,
--    and after each insertion, or change of a row's file or creation moment,
--    the file's investigation created last (the identifier between equals) is
--    marked and no other. At most one row per file is marked.
-- 2. A judgment's signature circle is read through its decision: the column
--    the snapshot reads becomes a foreign key, so that a query can follow it.
--
-- Adds a column with its default, marks the rows already there, an index, two
-- triggers and a foreign key. The previous version of the code writes nothing
-- this refuses: it never writes the mark, and every circle id it writes on a
-- decision is that of a circle it has just created.

-- AlterTable
ALTER TABLE "Investigation" ADD COLUMN "latest" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Investigation" AS i SET "latest" = true
FROM (SELECT DISTINCT ON ("caseFileId") id FROM "Investigation" ORDER BY "caseFileId", "createdAt" DESC, id DESC) AS l
WHERE i.id = l.id;

-- CreateIndex
CREATE UNIQUE INDEX "Investigation_latest_per_case_key" ON "Investigation"("caseFileId") WHERE "latest";

-- The mark of the latest investigation of one file.
CREATE FUNCTION "investigation_mark_latest_of"(file uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Investigation" SET "latest" = false WHERE "caseFileId" = file AND "latest";
  UPDATE "Investigation" SET "latest" = true
  WHERE id = (SELECT id FROM "Investigation" WHERE "caseFileId" = file ORDER BY "createdAt" DESC, id DESC LIMIT 1);
END;
$$;

CREATE FUNCTION "investigation_latest_after"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "investigation_mark_latest_of"(NEW."caseFileId");
  IF TG_OP = 'UPDATE' AND OLD."caseFileId" IS DISTINCT FROM NEW."caseFileId" THEN
    PERFORM "investigation_mark_latest_of"(OLD."caseFileId");
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "investigation_latest"
  AFTER INSERT OR UPDATE OF "createdAt", "caseFileId" ON "Investigation"
  FOR EACH ROW EXECUTE FUNCTION "investigation_latest_after"();

-- The mark is the database's alone: a row is inserted unmarked, and only the
-- trigger above (from inside a trigger, at depth 2) changes it.
CREATE FUNCTION "investigation_latest_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."latest" := false;
  ELSIF NEW."latest" IS DISTINCT FROM OLD."latest" AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'the latest investigation of a file is marked by the database alone' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "investigation_latest_guard"
  BEFORE INSERT OR UPDATE ON "Investigation"
  FOR EACH ROW EXECUTE FUNCTION "investigation_latest_guard"();

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_signatureCircleId_fkey" FOREIGN KEY ("signatureCircleId") REFERENCES "SignatureCircle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
