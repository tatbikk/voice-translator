-- Review P1-S-04: the circle's state is the fact the legal effect of a signed act
-- waits for. Its document, hash, signers and purpose never change; its status
-- moves only from OPEN, to VOIDED or to COMPLETED, and COMPLETED only when every
-- signer has signed. A circle is never deleted. Only adds a trigger: the previous
-- version of the code writes nothing this refuses.
CREATE FUNCTION "signature_circle_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  signed integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'signature circles are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."documentId" IS DISTINCT FROM OLD."documentId"
     OR NEW."documentSha256" IS DISTINCT FROM OLD."documentSha256"
     OR NEW."signers" IS DISTINCT FROM OLD."signers"
     OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
     OR NEW."openedAt" IS DISTINCT FROM OLD."openedAt" THEN
    RAISE EXCEPTION 'a signature circle is immutable but for its status' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" <> 'OPEN' THEN
      RAISE EXCEPTION 'a closed signature circle never changes' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW."status" = 'COMPLETED' THEN
      SELECT count(*) INTO signed FROM "Signature" WHERE "circleId" = NEW."id";
      IF signed < jsonb_array_length(NEW."signers") THEN
        RAISE EXCEPTION 'a signature circle completes only once every signer has signed' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "signature_circle_guard"
  BEFORE UPDATE OR DELETE ON "SignatureCircle"
  FOR EACH ROW EXECUTE FUNCTION "signature_circle_guard"();

CREATE TRIGGER "signature_circle_no_truncate"
  BEFORE TRUNCATE ON "SignatureCircle"
  FOR EACH STATEMENT EXECUTE FUNCTION "signature_append_only"();
