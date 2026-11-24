-- The administrator's session that created a non-demo account: the only session
-- that sees the account's activation links in the simulated outbox (review S-06).
ALTER TABLE "User" ADD COLUMN "createdInSessionId" UUID;
