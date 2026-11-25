-- CreateEnum
CREATE TYPE "CourtSpecialty" AS ENUM ('GENERAL', 'COMMERCIAL', 'ADMINISTRATIVE');

-- CreateEnum
CREATE TYPE "FilingChannel" AS ENUM ('ELECTRONIC', 'PAPER');

-- CreateEnum
CREATE TYPE "FilingStatus" AS ENUM ('DRAFT', 'FILED');

-- CreateEnum
CREATE TYPE "ApplicationMode" AS ENUM ('UPLOAD', 'PASTE', 'SCAN');

-- CreateEnum
CREATE TYPE "FixedCopyStatus" AS ENUM ('NONE', 'PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "FilingDocumentKind" AS ENUM ('APPLICATION_ORIGINAL', 'APPLICATION_COPY', 'EXHIBIT', 'PAYMENT_RECEIPT');

-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ONLINE', 'COUNTER');

-- CreateEnum
CREATE TYPE "ReferralTarget" AS ENUM ('PROSECUTION', 'ROYAL_COMMISSIONER');

-- CreateEnum
CREATE TYPE "ReferralGround" AS ENUM ('PRINCIPAL_PARTY', 'COMMUNICATION', 'ADMINISTRATIVE_COURT');

-- CreateEnum
CREATE TYPE "NoteReason" AS ENUM ('FEE_SHORTFALL', 'CLASSIFICATION', 'PARTIES', 'OTHER');

-- CreateEnum
CREATE TYPE "RegistryKind" AS ENUM ('COMMERCIAL_REGISTER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AddressKind" ADD VALUE 'RESIDENCE';
ALTER TYPE "AddressKind" ADD VALUE 'BRANCH';

-- AlterTable
ALTER TABLE "Court" ADD COLUMN     "specialty" "CourtSpecialty" NOT NULL DEFAULT 'GENERAL';

-- AlterTable
ALTER TABLE "RoleAssignment" ADD COLUMN     "professionalBody" TEXT,
ADD COLUMN     "professionalNumber" TEXT;

-- AlterTable
ALTER TABLE "CaseFile" ADD COLUMN     "classificationCorrectedAt" TIMESTAMPTZ(3),
ADD COLUMN     "designatedBailiffUserId" UUID,
ADD COLUMN     "filedByUserId" UUID,
ADD COLUMN     "filingChannel" "FilingChannel",
ADD COLUMN     "referredToCommissionerAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "CaseParty" ADD COLUMN     "agentAddress" TEXT,
ADD COLUMN     "agentName" TEXT,
ADD COLUMN     "capacityStatus" TEXT,
ADD COLUMN     "publicEntityKind" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "pageCount" INTEGER;

-- AlterTable
ALTER TABLE "FeeAssessment" ADD COLUMN     "draftId" UUID,
ADD COLUMN     "inputsDigest" CHAR(64),
ALTER COLUMN "caseFileId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "courtId" UUID,
ADD COLUMN     "draftId" UUID,
ADD COLUMN     "intentId" UUID,
ADD COLUMN     "method" "PaymentMethod",
ALTER COLUMN "caseFileId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TreasuryEntry" ADD COLUMN     "courtId" UUID,
ADD COLUMN     "draftId" UUID,
ALTER COLUMN "caseFileId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "FilingDraft" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "ownerRoleAssignmentId" UUID NOT NULL,
    "channel" "FilingChannel" NOT NULL,
    "status" "FilingStatus" NOT NULL DEFAULT 'DRAFT',
    "courtId" UUID,
    "suggestedCourtId" UUID,
    "caseType" TEXT,
    "defendantLocality" TEXT,
    "procedure" "ProcedureKind" NOT NULL DEFAULT 'WRITTEN',
    "card" JSONB NOT NULL DEFAULT '{"parties":[],"summary":"","claims":[]}',
    "attestations" JSONB NOT NULL DEFAULT '{}',
    "applicationMode" "ApplicationMode",
    "applicationText" TEXT,
    "applicationParagraphs" JSONB,
    "fixedCopyStatus" "FixedCopyStatus" NOT NULL DEFAULT 'NONE',
    "designatedBailiffUserId" UUID,
    "paperDepositor" JSONB,
    "paperLawyerUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "filedAt" TIMESTAMPTZ(3),
    "caseFileId" UUID,

    CONSTRAINT "FilingDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilingDocument" (
    "id" UUID NOT NULL,
    "draftId" UUID NOT NULL,
    "kind" "FilingDocumentKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "mediaType" TEXT NOT NULL,
    "title" TEXT,
    "declaredNature" "DocumentNature",
    "pageCount" INTEGER,
    "paperOriginalLocation" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "generated" BOOLEAN NOT NULL DEFAULT false,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL,
    "removedAt" TIMESTAMPTZ(3),
    "documentId" UUID,

    CONSTRAINT "FilingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" UUID NOT NULL,
    "draftId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "inputsDigest" CHAR(64) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "ruleSetId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'PENDING',
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseSequence" (
    "courtId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL,

    CONSTRAINT "CaseSequence_pkey" PRIMARY KEY ("courtId","year")
);

-- CreateTable
CREATE TABLE "CaseReferral" (
    "id" UUID NOT NULL,
    "caseFileId" UUID NOT NULL,
    "target" "ReferralTarget" NOT NULL,
    "ground" "ReferralGround" NOT NULL,
    "article" INTEGER NOT NULL,
    "item" INTEGER,
    "reasonCode" TEXT NOT NULL,
    "ruleSetId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CaseReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseNote" (
    "id" UUID NOT NULL,
    "caseFileId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "authorRole" "RoleCode" NOT NULL,
    "reason" "NoteReason" NOT NULL,
    "text" TEXT NOT NULL,
    "addressedToUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentParagraph" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "DocumentParagraph_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulatedRegistryEntry" (
    "id" UUID NOT NULL,
    "registry" "RegistryKind" NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "SimulatedRegistryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FilingDraft_caseFileId_key" ON "FilingDraft"("caseFileId");

-- CreateIndex
CREATE INDEX "FilingDraft_ownerUserId_status_idx" ON "FilingDraft"("ownerUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FilingDocument_storageKey_key" ON "FilingDocument"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "FilingDocument_documentId_key" ON "FilingDocument"("documentId");

-- CreateIndex
CREATE INDEX "FilingDocument_draftId_idx" ON "FilingDocument"("draftId");

-- CreateIndex
CREATE INDEX "PaymentIntent_draftId_idx" ON "PaymentIntent"("draftId");

-- CreateIndex
CREATE INDEX "CaseReferral_caseFileId_idx" ON "CaseReferral"("caseFileId");

-- CreateIndex
CREATE INDEX "CaseNote_caseFileId_idx" ON "CaseNote"("caseFileId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentParagraph_documentId_position_key" ON "DocumentParagraph"("documentId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SimulatedRegistryEntry_registry_key_key" ON "SimulatedRegistryEntry"("registry", "key");

-- CreateIndex
CREATE UNIQUE INDEX "CaseFile_courtId_number_year_key" ON "CaseFile"("courtId", "number", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_intentId_key" ON "Payment"("intentId");

-- CreateIndex
CREATE INDEX "Payment_courtId_paidAt_idx" ON "Payment"("courtId", "paidAt");

-- CreateIndex
CREATE INDEX "Payment_draftId_idx" ON "Payment"("draftId");

-- CreateIndex
CREATE INDEX "TreasuryEntry_courtId_at_idx" ON "TreasuryEntry"("courtId", "at");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilingDraft" ADD CONSTRAINT "FilingDraft_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilingDraft" ADD CONSTRAINT "FilingDraft_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilingDraft" ADD CONSTRAINT "FilingDraft_caseFileId_fkey" FOREIGN KEY ("caseFileId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilingDocument" ADD CONSTRAINT "FilingDocument_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "FilingDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "FilingDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseSequence" ADD CONSTRAINT "CaseSequence_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReferral" ADD CONSTRAINT "CaseReferral_caseFileId_fkey" FOREIGN KEY ("caseFileId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_caseFileId_fkey" FOREIGN KEY ("caseFileId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentParagraph" ADD CONSTRAINT "DocumentParagraph_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Phase 2 protections (docs/security/phase-2-memo.md, rows 7 and 8; decision 53).

-- The register's number, its year, the court and the national identifier of a
-- file never change once registered. The code changes only with the case type,
-- when the registry office corrects the classification.
CREATE OR REPLACE FUNCTION case_file_register_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."number" IS DISTINCT FROM OLD."number"
     OR NEW."year" IS DISTINCT FROM OLD."year"
     OR NEW."courtId" IS DISTINCT FROM OLD."courtId"
     OR NEW."nationalRef" IS DISTINCT FROM OLD."nationalRef" THEN
    RAISE EXCEPTION 'the number, year, court and national identifier of a file never change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER case_file_register_guard
  BEFORE UPDATE ON "CaseFile"
  FOR EACH ROW EXECUTE FUNCTION case_file_register_guard();

-- A payment and a treasury entry are never deleted, and change only by their
-- link to the file (and, for a payment, to its receipt), once, from nothing.
CREATE OR REPLACE FUNCTION money_record_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  linkable text[] := ARRAY['caseFileId', 'receiptDocumentId'];
  name text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - linkable) IS DISTINCT FROM (to_jsonb(OLD) - linkable) THEN
    RAISE EXCEPTION '% rows change only by their link to the file', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  FOREACH name IN ARRAY linkable LOOP
    IF (to_jsonb(OLD) ->> name) IS NOT NULL AND (to_jsonb(NEW) ->> name) IS DISTINCT FROM (to_jsonb(OLD) ->> name) THEN
      RAISE EXCEPTION '% rows are linked once', TG_TABLE_NAME USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION money_record_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is never emptied', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER payment_guard BEFORE UPDATE OR DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION money_record_guard();
CREATE TRIGGER payment_no_truncate BEFORE TRUNCATE ON "Payment" FOR EACH STATEMENT EXECUTE FUNCTION money_record_no_truncate();
CREATE TRIGGER treasury_entry_guard BEFORE UPDATE OR DELETE ON "TreasuryEntry" FOR EACH ROW EXECUTE FUNCTION money_record_guard();
CREATE TRIGGER treasury_entry_no_truncate BEFORE TRUNCATE ON "TreasuryEntry" FOR EACH STATEMENT EXECUTE FUNCTION money_record_no_truncate();

-- A payment is completed once: its operation reference is unique.
CREATE UNIQUE INDEX "Payment_operationRef_key" ON "Payment" ("operationRef");

-- The demo model courts are commercial courts of first instance and appeal
-- (src/cli/seed-data/accounts.ts); other courts keep the general default.
UPDATE "Court" SET "specialty" = 'COMMERCIAL' WHERE "code" IN ('demo-fi-commercial', 'demo-ap-commercial');
