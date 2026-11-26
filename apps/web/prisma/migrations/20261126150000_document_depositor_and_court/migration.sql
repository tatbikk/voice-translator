-- Independent review IR-06 (decision 71): the application a lawyer uploads as a
-- Word document stays in the file exactly as filed, for its depositor and the
-- judges and staff of the file's court only. A new visibility of a document; the
-- depositor is the document's "depositedByUserId" (Phase 1).
--
-- A value added to an enum cannot be used in the transaction that adds it: the
-- documents already filed take it in the next migration,
-- 20261126150100_application_source_depositor_and_court.

-- AlterEnum
ALTER TYPE "DocumentVisibility" ADD VALUE 'DEPOSITOR_AND_COURT';
