-- Independent review IR-06 (decision 71): an application uploaded as a Word
-- document and filed before this fix joined the file at the visibility of the
-- file ("CASE"), open to the prosecution, the royal commissioner and every
-- counsel. It becomes its depositor's and the court's; nothing else changes: its
-- bytes, its hash and its depositor stay as filed. Every such original was filed
-- electronically by the lawyer who owned the draft, recorded as its depositor.
UPDATE "Document"
   SET "visibility" = 'DEPOSITOR_AND_COURT'
 WHERE "docType" = 'APPLICATION_SOURCE'
   AND "visibility" = 'CASE';
