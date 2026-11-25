-- Review P1-A-18: the kinds and the dates of "RuleSet" are constrained in the
-- database, and two versions of one kind can never be in force on the same day.
-- Adds constraints and a trigger only, no column: the rows the previous version
-- of the code writes (four kinds, days written YYYY-MM-DD, no end date, one
-- version per kind) satisfy them, and so do the rows it has already loaded.
-- The kinds include those of the Phase 2 tables (CASE_TYPES, DISTRICTS,
-- REFERRALS, JURISDICTION); a later kind comes with its own migration.

-- A day written YYYY-MM-DD as a date, or NULL when the text is not one.
CREATE FUNCTION "rule_set_day"(day text) RETURNS date
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
BEGIN
  IF day !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RETURN NULL;
  END IF;
  RETURN make_date(substr(day, 1, 4)::integer, substr(day, 6, 2)::integer, substr(day, 9, 2)::integer);
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
  RETURN NULL;
END;
$$;

ALTER TABLE "RuleSet"
  ADD CONSTRAINT "RuleSet_kind_check"
    CHECK ("kind" IN ('TIME_LIMITS', 'FEES', 'HOLIDAYS', 'INTEREST', 'CASE_TYPES', 'DISTRICTS', 'REFERRALS', 'JURISDICTION')),
  ADD CONSTRAINT "RuleSet_validFrom_check"
    CHECK ("rule_set_day"("validFrom") IS NOT NULL),
  ADD CONSTRAINT "RuleSet_validTo_check"
    CHECK ("validTo" IS NULL OR ("rule_set_day"("validTo") IS NOT NULL AND "rule_set_day"("validTo") > "rule_set_day"("validFrom")));

-- The days a version is in force: from validFrom (included) to validTo (excluded).
CREATE FUNCTION "rule_set_days"("validFrom" text, "validTo" text) RETURNS daterange
LANGUAGE sql IMMUTABLE AS $$
  SELECT daterange("rule_set_day"("validFrom"), "rule_set_day"("validTo"), '[)')
$$;

-- No two versions of one kind overlap. Writers of one kind are serialised by a
-- transaction lock, so that the check sees every committed version; it is
-- refused at REPEATABLE READ, whose snapshot could not see them (the loader
-- writes at READ COMMITTED; SERIALIZABLE detects the conflict itself).
CREATE FUNCTION "rule_set_no_overlap"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  clash text;
BEGIN
  IF current_setting('transaction_isolation') = 'repeatable read' THEN
    RAISE EXCEPTION 'rule sets are written at READ COMMITTED or SERIALIZABLE' USING ERRCODE = 'invalid_transaction_state';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('RuleSet:' || NEW."kind"));
  SELECT r."version" INTO clash
    FROM "RuleSet" r
   WHERE r."kind" = NEW."kind"
     AND r."id" <> NEW."id"
     AND "rule_set_days"(r."validFrom", r."validTo") && "rule_set_days"(NEW."validFrom", NEW."validTo")
   LIMIT 1;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'rule set % % overlaps version %', NEW."kind", NEW."version", clash USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "rule_set_no_overlap"
  BEFORE INSERT OR UPDATE OF "kind", "validFrom", "validTo" ON "RuleSet"
  FOR EACH ROW EXECUTE FUNCTION "rule_set_no_overlap"();

-- The versions already loaded must not overlap either.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "RuleSet" a
      JOIN "RuleSet" b ON a."kind" = b."kind" AND a."id" < b."id"
     WHERE "rule_set_days"(a."validFrom", a."validTo") && "rule_set_days"(b."validFrom", b."validTo")
  ) THEN
    RAISE EXCEPTION 'overlapping rule sets are already loaded' USING ERRCODE = 'exclusion_violation';
  END IF;
END;
$$;
