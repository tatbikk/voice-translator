-- Phase 1: the whole case file, its procedure, money, enforcement, dated rule
-- tables and signatures (docs/data-model.md, «توسعة المرحلة 1»). New tables and
-- optional or defaulted columns only, so that the previous version keeps running
-- while this migration is applied.

-- CreateEnum
CREATE TYPE "CaseKind" AS ENUM ('FIRST_INSTANCE', 'APPEAL', 'ENFORCEMENT');

-- CreateEnum
CREATE TYPE "ProcedureKind" AS ENUM ('WRITTEN', 'ORAL');

-- CreateEnum
CREATE TYPE "HearingKind" AS ENUM ('ORDINARY', 'PRONOUNCEMENT');

-- CreateEnum
CREATE TYPE "PartySide" AS ENUM ('PLAINTIFF', 'DEFENDANT', 'GUARANTOR', 'APPELLANT', 'RESPONDENT', 'ENFORCEMENT_CREDITOR', 'ENFORCEMENT_DEBTOR', 'GARNISHEE');

-- CreateEnum
CREATE TYPE "PersonKind" AS ENUM ('NATURAL', 'LEGAL', 'PUBLIC');

-- CreateEnum
CREATE TYPE "AddressKind" AS ENUM ('DOMICILE', 'REGISTERED_OFFICE', 'ELECTED', 'ELECTRONIC', 'PHONE');

-- CreateEnum
CREATE TYPE "AddressSource" AS ENUM ('DECLARED', 'COMMERCIAL_REGISTER', 'NATIONAL_ID_DATABASE', 'PLATFORM');

-- CreateEnum
CREATE TYPE "ClaimCategory" AS ENUM ('PRINCIPAL', 'COUNTER', 'INCIDENTAL');

-- CreateEnum
CREATE TYPE "ClaimNature" AS ENUM ('DEBT', 'DAMAGES', 'LEGAL_INTEREST', 'PROVISIONAL_ENFORCEMENT', 'COSTS', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentNature" AS ENUM ('ORIGINAL', 'CERTIFIED_COPY', 'PHOTOCOPY');

-- CreateEnum
CREATE TYPE "DocumentChannel" AS ENUM ('ELECTRONIC', 'PAPER');

-- CreateEnum
CREATE TYPE "DocumentVisibility" AS ENUM ('CASE', 'PANEL', 'JUDGE');

-- CreateEnum
CREATE TYPE "TimeLimitStatus" AS ENUM ('RUNNING', 'MET', 'ELAPSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "EnvelopeChannel" AS ENUM ('ELECTRONIC', 'BAILIFF', 'CLERK', 'ADMINISTRATIVE', 'REGISTERED_MAIL');

-- CreateEnum
CREATE TYPE "EnvelopeStatus" AS ENUM ('READY', 'DISPATCHED', 'IN_PROGRESS', 'SERVED', 'REFUSED', 'FAILED_UNKNOWN', 'FAILED_MOVED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CircleStatus" AS ENUM ('OPEN', 'COMPLETED', 'VOIDED');

-- AlterEnum
ALTER TYPE "AttemptKind" ADD VALUE 'SIGNING_SECRET';

-- AlterTable
ALTER TABLE "CaseFile" ADD COLUMN     "caseType" TEXT,
ADD COLUMN     "facts" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "kind" "CaseKind" NOT NULL DEFAULT 'FIRST_INSTANCE',
ADD COLUMN     "panelId" UUID,
ADD COLUMN     "parentCaseFileId" UUID,
ADD COLUMN     "procedure" "ProcedureKind" NOT NULL DEFAULT 'WRITTEN',
ADD COLUMN     "pronouncementDate" TEXT,
ADD COLUMN     "rapporteurUserId" UUID,
ADD COLUMN     "readyAt" TIMESTAMPTZ(3),
ADD COLUMN     "referredToProsecutionAt" TIMESTAMPTZ(3),
ADD COLUMN     "registeredAt" TIMESTAMPTZ(3),
ADD COLUMN     "registrationStampedAt" TIMESTAMPTZ(3),
ADD COLUMN     "subject" TEXT;

-- AlterTable
ALTER TABLE "Hearing" ADD COLUMN     "heldAt" TIMESTAMPTZ(3),
ADD COLUMN     "kind" "HearingKind" NOT NULL DEFAULT 'ORDINARY';

-- CreateTable
CREATE TABLE "CaseParty" (
    "id" UUID NOT NULL,
    "caseFileId" UUID NOT NULL,
    "side" "PartySide" NOT NULL,
    "personKind" "PersonKind" NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalForm" TEXT,
    "legalRepresentative" TEXT,
    "idNumber" TEXT,
    "litigantUserId" UUID,
    "organizationId" UUID,
    "eServiceAcceptedAt" TIMESTAMPTZ(3),
    "facts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CaseParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyAddress" (
    "id" UUID NOT NULL,
    "partyId" UUID NOT NULL,
    "kind" "AddressKind" NOT NULL,
    "value" TEXT NOT NULL,
    "source" "AddressSource" NOT NULL,
    "withinCourtDistrict" BOOLEAN,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "supersededAt" TIMESTAMPTZ(3),

    CONSTRAINT "PartyAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Representation" (
    "id" UUID NOT NULL,
    "partyId" UUID NOT NULL,
    "lawyerUserId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "accountServiceConsentAt" TIMESTAMPTZ(3),

    CONSTRAINT "Representation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" UUID NOT NULL,
    "caseFileId" UUID NOT NULL,
    "partyId" UUID,
    "category" "ClaimCategory" NOT NULL,
    "nature" "ClaimNature" NOT NULL,
    "amountCents" BIGINT,
    "basis" TEXT,
    "filedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "caseFileId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "mediaType" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "title" TEXT,
    "declaredNature" "DocumentNature",
    "channel" "DocumentChannel" NOT NULL,
    "paperOriginalLocation" TEXT,
    "depositedByUserId" UUID,
    "depositedByPartyId" UUID,
    "depositedAt" TIMESTAMPTZ(3) NOT NULL,
    "generated" BOOLEAN NOT NULL DEFAULT false,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "withdrawnAt" TIMESTAMPTZ(3),
    "visibility" "DocumentVisibility" NOT NULL DEFAULT 'CASE',

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeLimit" (
    "id" UUID NOT NULL,
    "caseFileId" UUID NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "ruleSetId" UUID NOT NULL,
    "partyId" UUID,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "lastDay" TEXT NOT NULL,
    "electronic" BOOLEAN NOT NULL DEFAULT false,
    "status" "TimeLimitStatus" NOT NULL DEFAULT 'RUNNING',
    "closedAt" TIMESTAMPTZ(3),
    "computation" JSONB NOT NULL,

    CONSTRAINT "TimeLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Envelope" (
    "id" UUID NOT NULL,
    "caseFileId" UUID NOT NULL,
    "partyId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "channel" "EnvelopeChannel" NOT NULL,
    "agentUserId" UUID,
    "status" "EnvelopeStatus" NOT NULL DEFAULT 'READY',
    "dispatchedAt" TIMESTAMPTZ(3),
    "servedAt" TIMESTAMPTZ(3),
    "deemedServedAt" TIMESTAMPTZ(3),
    "documentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Envelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryCertificate" (
    "id" UUID NOT NULL,
    "envelopeId" UUID NOT NULL,
    "recipientName" TEXT,
    "recipientIdNumber" TEXT,
    "recipientCapacity" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "signature" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "recordedByUserId" UUID NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "DeliveryCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptNotice" (
    "id" UUID NOT NULL,
    "envelopeId" UUID NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ReceiptNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HearingListing" (
    "id" UUID NOT NULL,
    "hearingId" UUID NOT NULL,
    "caseFileId" UUID NOT NULL,
    "outcome" TEXT,
    "outcomeReason" TEXT,
    "minutesDocumentId" UUID,

    CONSTRAINT "HearingListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" UUID NOT NULL,
    "caseFileId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectCode" TEXT NOT NULL,
    "documentId" UUID,
    "signatureCircleId" UUID,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL,
    "pronouncedAt" TIMESTAMPTZ(3),
    "provisionalEnforcement" BOOLEAN NOT NULL DEFAULT false,
    "final" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Investigation" (
    "id" UUID NOT NULL,
    "caseFileId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "orderDecisionId" UUID,
    "expertUserId" UUID,
    "mission" TEXT,
    "depositAmountCents" BIGINT,
    "depositPartyId" UUID,
    "depositedAt" TIMESTAMPTZ(3),
    "acceptedAt" TIMESTAMPTZ(3),
    "declinedAt" TIMESTAMPTZ(3),
    "partiesSummonedAt" TIMESTAMPTZ(3),
    "reportDocumentId" UUID,
    "reportDepositedAt" TIMESTAMPTZ(3),
    "returnedAt" TIMESTAMPTZ(3),
    "feesOrderedCents" BIGINT,
    "feesPaidAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Investigation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appeal" (
    "id" UUID NOT NULL,
    "lowerCaseFileId" UUID NOT NULL,
    "upperCaseFileId" UUID,
    "kind" TEXT NOT NULL,
    "appellantPartyId" UUID NOT NULL,
    "filedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Appeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeAssessment" (
    "id" UUID NOT NULL,
    "caseFileId" UUID NOT NULL,
    "filing" TEXT NOT NULL,
    "ruleSetId" UUID NOT NULL,
    "totalCents" BIGINT NOT NULL,
    "breakdown" JSONB NOT NULL,
    "assessedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FeeAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "caseFileId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "payerUserId" UUID,
    "payerPartyId" UUID,
    "status" "PaymentStatus" NOT NULL,
    "operationRef" TEXT NOT NULL,
    "receiptDocumentId" UUID,
    "paidAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryEntry" (
    "id" UUID NOT NULL,
    "caseFileId" UUID NOT NULL,
    "paymentId" UUID,
    "direction" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "purpose" TEXT NOT NULL,
    "beneficiary" TEXT,
    "authorizedByDecisionId" UUID,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TreasuryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnforcementStep" (
    "id" UUID NOT NULL,
    "caseFileId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "outcome" TEXT,
    "amountCents" BIGINT,
    "organizationId" UUID,
    "documentId" UUID,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EnforcementStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleSet" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "validFrom" TEXT NOT NULL,
    "validTo" TEXT,
    "contentSha256" CHAR(64) NOT NULL,
    "content" JSONB NOT NULL,
    "loadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleChange" (
    "id" UUID NOT NULL,
    "ruleSetId" UUID NOT NULL,
    "enteredByUserId" UUID,
    "validatedByUserId" UUID,
    "enteredAt" TIMESTAMPTZ(3) NOT NULL,
    "validatedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RuleChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SigningCredential" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "secretHash" TEXT NOT NULL,
    "setAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SigningCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureCircle" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "signers" JSONB NOT NULL,
    "documentSha256" CHAR(64) NOT NULL,
    "status" "CircleStatus" NOT NULL DEFAULT 'OPEN',
    "voidReason" TEXT,
    "openedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SignatureCircle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signature" (
    "id" UUID NOT NULL,
    "circleId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "signerUserId" UUID NOT NULL,
    "signerRoleAssignmentId" UUID NOT NULL,
    "signerRole" TEXT NOT NULL,
    "documentSha256" CHAR(64) NOT NULL,
    "signedAt" TIMESTAMPTZ(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,

    CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaseParty_caseFileId_idx" ON "CaseParty"("caseFileId");

-- CreateIndex
CREATE INDEX "CaseParty_litigantUserId_idx" ON "CaseParty"("litigantUserId");

-- CreateIndex
CREATE INDEX "CaseParty_organizationId_idx" ON "CaseParty"("organizationId");

-- CreateIndex
CREATE INDEX "PartyAddress_partyId_idx" ON "PartyAddress"("partyId");

-- CreateIndex
CREATE INDEX "Representation_partyId_idx" ON "Representation"("partyId");

-- CreateIndex
CREATE INDEX "Representation_lawyerUserId_idx" ON "Representation"("lawyerUserId");

-- CreateIndex
CREATE INDEX "Claim_caseFileId_idx" ON "Claim"("caseFileId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "Document_caseFileId_idx" ON "Document"("caseFileId");

-- CreateIndex
CREATE INDEX "TimeLimit_caseFileId_idx" ON "TimeLimit"("caseFileId");

-- CreateIndex
CREATE INDEX "TimeLimit_status_endsAt_idx" ON "TimeLimit"("status", "endsAt");

-- CreateIndex
CREATE INDEX "Envelope_caseFileId_idx" ON "Envelope"("caseFileId");

-- CreateIndex
CREATE INDEX "Envelope_agentUserId_idx" ON "Envelope"("agentUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryCertificate_envelopeId_key" ON "DeliveryCertificate"("envelopeId");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptNotice_envelopeId_key" ON "ReceiptNotice"("envelopeId");

-- CreateIndex
CREATE UNIQUE INDEX "HearingListing_hearingId_caseFileId_key" ON "HearingListing"("hearingId", "caseFileId");

-- CreateIndex
CREATE INDEX "Decision_caseFileId_idx" ON "Decision"("caseFileId");

-- CreateIndex
CREATE INDEX "Investigation_caseFileId_idx" ON "Investigation"("caseFileId");

-- CreateIndex
CREATE INDEX "Investigation_expertUserId_idx" ON "Investigation"("expertUserId");

-- CreateIndex
CREATE INDEX "FeeAssessment_caseFileId_idx" ON "FeeAssessment"("caseFileId");

-- CreateIndex
CREATE INDEX "Payment_caseFileId_idx" ON "Payment"("caseFileId");

-- CreateIndex
CREATE INDEX "TreasuryEntry_caseFileId_idx" ON "TreasuryEntry"("caseFileId");

-- CreateIndex
CREATE INDEX "EnforcementStep_caseFileId_idx" ON "EnforcementStep"("caseFileId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleSet_kind_version_key" ON "RuleSet"("kind", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SigningCredential_userId_key" ON "SigningCredential"("userId");

-- CreateIndex
CREATE INDEX "SignatureCircle_documentId_idx" ON "SignatureCircle"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "Signature_circleId_position_key" ON "Signature"("circleId", "position");

-- CreateIndex
CREATE INDEX "CaseFile_rapporteurUserId_idx" ON "CaseFile"("rapporteurUserId");

-- CreateIndex
CREATE INDEX "CaseFile_panelId_idx" ON "CaseFile"("panelId");

-- AddForeignKey
ALTER TABLE "CaseFile" ADD CONSTRAINT "CaseFile_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFile" ADD CONSTRAINT "CaseFile_rapporteurUserId_fkey" FOREIGN KEY ("rapporteurUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFile" ADD CONSTRAINT "CaseFile_parentCaseFileId_fkey" FOREIGN KEY ("parentCaseFileId") REFERENCES "CaseFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseParty" ADD CONSTRAINT "CaseParty_caseFileId_fkey" FOREIGN KEY ("caseFileId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyAddress" ADD CONSTRAINT "PartyAddress_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "CaseParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Representation" ADD CONSTRAINT "Representation_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "CaseParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Representation" ADD CONSTRAINT "Representation_lawyerUserId_fkey" FOREIGN KEY ("lawyerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_caseFileId_fkey" FOREIGN KEY ("caseFileId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "CaseParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_caseFileId_fkey" FOREIGN KEY ("caseFileId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeLimit" ADD CONSTRAINT "TimeLimit_caseFileId_fkey" FOREIGN KEY ("caseFileId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeLimit" ADD CONSTRAINT "TimeLimit_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "CaseParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_caseFileId_fkey" FOREIGN KEY ("caseFileId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "CaseParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryCertificate" ADD CONSTRAINT "DeliveryCertificate_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptNotice" ADD CONSTRAINT "ReceiptNotice_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HearingListing" ADD CONSTRAINT "HearingListing_hearingId_fkey" FOREIGN KEY ("hearingId") REFERENCES "Hearing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HearingListing" ADD CONSTRAINT "HearingListing_caseFileId_fkey" FOREIGN KEY ("caseFileId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_caseFileId_fkey" FOREIGN KEY ("caseFileId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_caseFileId_fkey" FOREIGN KEY ("caseFileId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_lowerCaseFileId_fkey" FOREIGN KEY ("lowerCaseFileId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_upperCaseFileId_fkey" FOREIGN KEY ("upperCaseFileId") REFERENCES "CaseFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeAssessment" ADD CONSTRAINT "FeeAssessment_caseFileId_fkey" FOREIGN KEY ("caseFileId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_caseFileId_fkey" FOREIGN KEY ("caseFileId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryEntry" ADD CONSTRAINT "TreasuryEntry_caseFileId_fkey" FOREIGN KEY ("caseFileId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnforcementStep" ADD CONSTRAINT "EnforcementStep_caseFileId_fkey" FOREIGN KEY ("caseFileId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleChange" ADD CONSTRAINT "RuleChange_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "RuleSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningCredential" ADD CONSTRAINT "SigningCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureCircle" ADD CONSTRAINT "SignatureCircle_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "SignatureCircle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A signature is never changed nor erased, and a document never erased
-- (prompt, «التوقيع الإلكتروني»; study, «البيانات التي تقوم عليها المنصة»: «ولا
-- تحذف وثيقة من الملف أبدا»). The runtime role does not own these tables, so it
-- cannot disable the triggers.
CREATE FUNCTION "signature_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'signatures are append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "signature_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "Signature"
  FOR EACH ROW EXECUTE FUNCTION "signature_append_only"();

CREATE TRIGGER "signature_no_truncate"
  BEFORE TRUNCATE ON "Signature"
  FOR EACH STATEMENT EXECUTE FUNCTION "signature_append_only"();

CREATE FUNCTION "document_never_deleted"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'documents are never deleted' USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "document_no_delete"
  BEFORE DELETE ON "Document"
  FOR EACH ROW EXECUTE FUNCTION "document_never_deleted"();

CREATE TRIGGER "document_no_truncate"
  BEFORE TRUNCATE ON "Document"
  FOR EACH STATEMENT EXECUTE FUNCTION "document_never_deleted"();

-- The hash of a stored document never changes: a new version is a new document.
CREATE FUNCTION "document_hash_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."sha256" <> OLD."sha256" OR NEW."storageKey" <> OLD."storageKey" OR NEW."caseFileId" <> OLD."caseFileId" THEN
    RAISE EXCEPTION 'a document keeps its hash, key and file' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "document_hash_guard"
  BEFORE UPDATE ON "Document"
  FOR EACH ROW EXECUTE FUNCTION "document_hash_immutable"();
