-- Review of the fix of IR-08 (decision 69): whether an address lies within the
-- district of the file's court is known only with its place, a locality of the
-- districts table or a country outside the Kingdom; otherwise it is unknown
-- (NULL), never assumed.
--
-- The demo seed of Phase 1 wrote "withinCourtDistrict" TRUE on every demo
-- address, with no locality (the column did not exist): an assumption, false
-- for the appellant in Rabat of file 312. The registration never wrote the
-- column before 20261126130000_party_place_and_quality. Those rows become
-- unknown; nothing else changes, and the seed is not run again.

-- A value the platform never read from the districts table becomes unknown.
UPDATE "PartyAddress"
   SET "withinCourtDistrict" = NULL
 WHERE "withinCourtDistrict" IS NOT NULL
   AND "locality" IS NULL
   AND "country" IS NULL;

-- And no row says «within» or «outside» the district without its place.
ALTER TABLE "PartyAddress"
  ADD CONSTRAINT "PartyAddress_district_needs_place_check"
    CHECK ("withinCourtDistrict" IS NULL OR "locality" IS NOT NULL OR "country" IS NOT NULL);
