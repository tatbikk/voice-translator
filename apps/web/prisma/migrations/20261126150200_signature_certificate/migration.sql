-- Independent review IR-07 (decision 72): once the electronic application is
-- signed at registration, the platform prints «شهادة توقيع», a generated
-- document of the file linked to the application it attests, so that Phase 3
-- serves both together. The application's bytes and hash never change.
--
-- Adds a nullable column, its index and its foreign key, and a guard: the link
-- of a certificate to the document it attests never changes once written.

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "attestsDocumentId" UUID;

-- CreateIndex
CREATE INDEX "Document_attestsDocumentId_idx" ON "Document"("attestsDocumentId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_attestsDocumentId_fkey" FOREIGN KEY ("attestsDocumentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A document attesting another one keeps it: the column is written with the row, never after.
CREATE FUNCTION "document_attestation_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."attestsDocumentId" IS DISTINCT FROM OLD."attestsDocumentId" THEN
    RAISE EXCEPTION 'a document keeps the document it attests' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "document_attestation_guard"
  BEFORE UPDATE ON "Document"
  FOR EACH ROW EXECUTE FUNCTION "document_attestation_immutable"();
