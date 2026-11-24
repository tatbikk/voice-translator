-- CreateEnum
CREATE TYPE "CourtDegree" AS ENUM ('FIRST_INSTANCE', 'APPEAL');

-- CreateEnum
CREATE TYPE "PanelKind" AS ENUM ('COLLEGIAL', 'SINGLE');

-- CreateEnum
CREATE TYPE "OrganizationKind" AS ENUM ('LAW_FIRM', 'BANK', 'PUBLIC_ADMINISTRATION', 'STATE_JUDICIAL_AGENCY', 'EXPERT_OFFICE', 'BAILIFF_OFFICE');

-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('LAWYER', 'LAWYER_ASSISTANT', 'CLERK_REGISTRATION', 'CLERK_CASHIER', 'CLERK_NOTIFICATION', 'CLERK_HEARING', 'CLERK_COPIES_ENFORCEMENT', 'CHIEF_CLERK', 'COURT_PRESIDENT', 'JUDGE_RAPPORTEUR', 'JUDGE_IN_CHARGE', 'COUNSELLOR_RAPPORTEUR', 'PANEL_PRESIDENT', 'PANEL_MEMBER', 'PUBLIC_PROSECUTOR', 'ROYAL_COMMISSIONER', 'BAILIFF', 'EXPERT', 'ENFORCEMENT_JUDGE', 'LITIGANT', 'PUBLIC_ADMIN_SUPERVISOR', 'PUBLIC_ADMIN_LITIGATION', 'STATE_JUDICIAL_AGENT', 'GARNISHEE_BANK', 'SYSTEM_ADMIN', 'RULES_LEGAL_VALIDATOR');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('VERIFIED_SIMULATED', 'VERIFIED', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "SessionState" AS ENUM ('PENDING_SECOND_FACTOR', 'PENDING_ROLE', 'ACTIVE');

-- CreateEnum
CREATE TYPE "SessionOrigin" AS ENUM ('LOGIN', 'DEMO_SWITCH');

-- CreateEnum
CREATE TYPE "AttemptKind" AS ENUM ('PASSWORD', 'SECOND_FACTOR', 'SECOND_FACTOR_ISSUE', 'ACCESS_CODE', 'REAUTH', 'ACTIVATION');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('LEGAL_NOTIFICATION', 'INFORMATION', 'REMINDER');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'DEAD');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('FILED', 'REGISTERED', 'RAPPORTEUR_ASSIGNED', 'IN_NOTIFICATION', 'IN_PREPARATION', 'IN_EXPERTISE', 'READY', 'IN_DELIBERATION', 'JUDGMENT_ISSUED', 'UNDER_APPEAL', 'IN_ENFORCEMENT', 'CLOSED');

-- CreateTable
CREATE TABLE "Court" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "degree" "CourtDegree" NOT NULL,
    "appealCourtId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Court_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Panel" (
    "id" UUID NOT NULL,
    "courtId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PanelKind" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Panel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "kind" "OrganizationKind" NOT NULL,
    "name" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "disabledAt" TIMESTAMPTZ(3),
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleAssignment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "RoleCode" NOT NULL,
    "courtId" UUID,
    "organizationId" UUID,
    "panelId" UUID,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verificationSource" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "state" "SessionState" NOT NULL,
    "origin" "SessionOrigin" NOT NULL DEFAULT 'LOGIN',
    "roleAssignmentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "pendingExpiresAt" TIMESTAMPTZ(3),
    "previousLoginAt" TIMESTAMPTZ(3),
    "reauthAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokeReason" TEXT,
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "clientIdHash" CHAR(64),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecondFactorChallenge" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeMac" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "voidedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SecondFactorChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnownDevice" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceIdHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "KnownDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivationToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "voidedAt" TIMESTAMPTZ(3),
    "createdByUserId" UUID,

    CONSTRAINT "ActivationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAttempt" (
    "id" UUID NOT NULL,
    "kind" "AttemptKind" NOT NULL,
    "identifierHash" CHAR(64),
    "bucket" TEXT NOT NULL DEFAULT 'default',
    "clientIdHash" CHAR(64),
    "ok" BOOLEAN NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuthAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lockout" (
    "id" UUID NOT NULL,
    "identifierHash" CHAR(64) NOT NULL,
    "bucket" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "until" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Lockout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitHit" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "seq" BIGINT NOT NULL,
    "id" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "actorUserId" UUID,
    "actorRoleAssignmentId" UUID,
    "actorRole" TEXT,
    "viaDemoSwitch" BOOLEAN NOT NULL DEFAULT false,
    "clientIdHash" CHAR(64),
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "caseFileId" UUID,
    "legalBasis" JSONB,
    "details" JSONB NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "prevHash" CHAR(64) NOT NULL,
    "hash" CHAR(64) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "templateKey" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "caseFileId" UUID,
    "targetPath" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "readAt" TIMESTAMPTZ(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" UUID NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "sender" TEXT NOT NULL,
    "recipientUserId" UUID,
    "recipientAddress" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "holdsSecret" BOOLEAN NOT NULL DEFAULT false,
    "visibleToSessionId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "databaseMode" TEXT,
    "chainHeadSeq" BIGINT,
    "chainHeadHash" CHAR(64),
    "chainStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "brokenAtSeq" BIGINT,
    "lastVerifiedAt" TIMESTAMPTZ(3),
    "lastFullVerifiedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformClock" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "offsetSeconds" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformClock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretSetting" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "tag" BYTEA NOT NULL,
    "last4" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedByUserId" UUID,

    CONSTRAINT "SecretSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstitutionalIdentity" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "operatorName" TEXT,
    "headerLines" JSONB,
    "logoFileId" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstitutionalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "runAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMPTZ(3),
    "lockedBy" TEXT,
    "lastErrorClass" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseFile" (
    "id" UUID NOT NULL,
    "nationalRef" TEXT NOT NULL,
    "courtId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "code" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "CaseStatus" NOT NULL,
    "nextHearingId" UUID,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CaseFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hearing" (
    "id" UUID NOT NULL,
    "courtId" UUID NOT NULL,
    "panelId" UUID NOT NULL,
    "room" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Hearing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Court_code_key" ON "Court"("code");

-- CreateIndex
CREATE INDEX "Panel_courtId_idx" ON "Panel"("courtId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "RoleAssignment_userId_idx" ON "RoleAssignment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "SecondFactorChallenge_userId_idx" ON "SecondFactorChallenge"("userId");

-- CreateIndex
CREATE INDEX "SecondFactorChallenge_sessionId_idx" ON "SecondFactorChallenge"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "KnownDevice_userId_deviceIdHash_key" ON "KnownDevice"("userId", "deviceIdHash");

-- CreateIndex
CREATE UNIQUE INDEX "ActivationToken_tokenHash_key" ON "ActivationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ActivationToken_userId_idx" ON "ActivationToken"("userId");

-- CreateIndex
CREATE INDEX "AuthAttempt_kind_identifierHash_bucket_at_idx" ON "AuthAttempt"("kind", "identifierHash", "bucket", "at");

-- CreateIndex
CREATE INDEX "AuthAttempt_kind_clientIdHash_at_idx" ON "AuthAttempt"("kind", "clientIdHash", "at");

-- CreateIndex
CREATE INDEX "AuthAttempt_kind_at_idx" ON "AuthAttempt"("kind", "at");

-- CreateIndex
CREATE INDEX "Lockout_identifierHash_bucket_until_idx" ON "Lockout"("identifierHash", "bucket", "until");

-- CreateIndex
CREATE INDEX "RateLimitHit_key_at_idx" ON "RateLimitHit"("key", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Event_id_key" ON "Event"("id");

-- CreateIndex
CREATE UNIQUE INDEX "Event_hash_key" ON "Event"("hash");

-- CreateIndex
CREATE INDEX "Event_action_idx" ON "Event"("action");

-- CreateIndex
CREATE INDEX "Event_caseFileId_idx" ON "Event"("caseFileId");

-- CreateIndex
CREATE INDEX "Event_actorUserId_idx" ON "Event"("actorUserId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_createdAt_idx" ON "OutboundMessage"("createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_recipientUserId_idx" ON "OutboundMessage"("recipientUserId");

-- CreateIndex
CREATE UNIQUE INDEX "SecretSetting_name_key" ON "SecretSetting"("name");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "CaseFile_nationalRef_key" ON "CaseFile"("nationalRef");

-- CreateIndex
CREATE UNIQUE INDEX "CaseFile_courtId_number_code_year_key" ON "CaseFile"("courtId", "number", "code", "year");

-- CreateIndex
CREATE INDEX "Hearing_courtId_startsAt_idx" ON "Hearing"("courtId", "startsAt");

-- AddForeignKey
ALTER TABLE "Court" ADD CONSTRAINT "Court_appealCourtId_fkey" FOREIGN KEY ("appealCourtId") REFERENCES "Court"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Panel" ADD CONSTRAINT "Panel_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_roleAssignmentId_fkey" FOREIGN KEY ("roleAssignmentId") REFERENCES "RoleAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecondFactorChallenge" ADD CONSTRAINT "SecondFactorChallenge_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecondFactorChallenge" ADD CONSTRAINT "SecondFactorChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnownDevice" ADD CONSTRAINT "KnownDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationToken" ADD CONSTRAINT "ActivationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFile" ADD CONSTRAINT "CaseFile_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFile" ADD CONSTRAINT "CaseFile_nextHearingId_fkey" FOREIGN KEY ("nextHearingId") REFERENCES "Hearing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hearing" ADD CONSTRAINT "Hearing_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hearing" ADD CONSTRAINT "Hearing_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Protections written by hand (docs/data-model.md). They live in the database
-- itself, not only in the code.

-- 1. The event log is append-only: no row may be changed or deleted, and the
--    table may not be truncated. The runtime role additionally holds only
--    SELECT and INSERT on it and owns nothing (src/cli/db-roles.ts), so it can
--    neither disable these triggers nor drop the table.
CREATE FUNCTION "event_log_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the event log is append-only (% refused)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "event_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "Event"
  FOR EACH ROW EXECUTE FUNCTION "event_log_append_only"();

CREATE TRIGGER "event_no_truncate"
  BEFORE TRUNCATE ON "Event"
  FOR EACH STATEMENT EXECUTE FUNCTION "event_log_append_only"();

ALTER TABLE "Event" ADD CONSTRAINT "event_seq_positive" CHECK ("seq" > 0);
ALTER TABLE "Event" ADD CONSTRAINT "event_outcome_known" CHECK ("outcome" IN ('DONE', 'DENIED', 'FAILED'));

-- 2. The database stamp (demo | production) is one-way: once set it never
--    changes, and the state row cannot be deleted afterwards.
ALTER TABLE "SystemState" ADD CONSTRAINT "system_state_single_row" CHECK ("id" = 1);
ALTER TABLE "SystemState" ADD CONSTRAINT "system_state_mode_known"
  CHECK ("databaseMode" IS NULL OR "databaseMode" IN ('demo', 'production'));
ALTER TABLE "SystemState" ADD CONSTRAINT "system_state_chain_status_known"
  CHECK ("chainStatus" IN ('UNVERIFIED', 'OK', 'BROKEN'));

CREATE FUNCTION "system_state_stamp_one_way"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."databaseMode" IS NOT NULL THEN
      RAISE EXCEPTION 'the database stamp cannot be removed'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."databaseMode" IS NOT NULL AND NEW."databaseMode" IS DISTINCT FROM OLD."databaseMode" THEN
    RAISE EXCEPTION 'the database stamp cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "system_state_stamp_guard"
  BEFORE UPDATE OR DELETE ON "SystemState"
  FOR EACH ROW EXECUTE FUNCTION "system_state_stamp_one_way"();

-- 3. The platform clock only moves forward (demo only; production refuses to
--    boot with an offset other than zero).
ALTER TABLE "PlatformClock" ADD CONSTRAINT "platform_clock_single_row" CHECK ("id" = 1);
ALTER TABLE "PlatformClock" ADD CONSTRAINT "platform_clock_offset_non_negative" CHECK ("offsetSeconds" >= 0);

CREATE FUNCTION "platform_clock_forward_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'the platform clock row cannot be deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW."offsetSeconds" < OLD."offsetSeconds" THEN
    RAISE EXCEPTION 'the platform clock cannot move backwards'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "platform_clock_guard"
  BEFORE UPDATE OR DELETE ON "PlatformClock"
  FOR EACH ROW EXECUTE FUNCTION "platform_clock_forward_only"();

ALTER TABLE "InstitutionalIdentity" ADD CONSTRAINT "institutional_identity_single_row" CHECK ("id" = 1);

-- 4. Singleton rows exist from the start.
INSERT INTO "SystemState" ("id", "chainStatus", "updatedAt") VALUES (1, 'UNVERIFIED', CURRENT_TIMESTAMP);
INSERT INTO "PlatformClock" ("id", "offsetSeconds", "updatedAt") VALUES (1, 0, CURRENT_TIMESTAMP);
INSERT INTO "InstitutionalIdentity" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP);
