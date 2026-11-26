-- Independent review IR-08 (decision 69): what Phase 3 needs about the parties
-- is kept when the case is registered. The party keeps its «صفة» (art. 77), and
-- each address its locality of the districts table or, outside the Kingdom, its
-- country (art. 89); "withinCourtDistrict" (Phase 1) is now filled from the
-- districts table in force. Adds nullable columns and two checks only: the rows
-- already written (no locality, no country) satisfy them.

-- AlterTable
ALTER TABLE "CaseParty" ADD COLUMN "quality" TEXT;

-- AlterTable
ALTER TABLE "PartyAddress" ADD COLUMN "locality" TEXT,
ADD COLUMN "country" TEXT;

-- An address lies in a locality of the Kingdom or in another country, not both;
-- and an address outside the Kingdom lies within no district of a court of it.
ALTER TABLE "PartyAddress"
  ADD CONSTRAINT "PartyAddress_locality_or_country_check"
    CHECK ("locality" IS NULL OR "country" IS NULL),
  ADD CONSTRAINT "PartyAddress_abroad_outside_district_check"
    CHECK ("country" IS NULL OR "withinCourtDistrict" IS FALSE);
