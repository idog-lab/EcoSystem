-- CreateTable
CREATE TABLE "DocumentExport" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "target" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveRun" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "revision" INTEGER,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObservedResult" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "segment" INTEGER,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "sampleSize" INTEGER,
    "population" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL,
    "liveRevisions" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObservedResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentExport_documentId_createdAt_idx" ON "DocumentExport"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "LiveRun_documentId_eventId_effectiveFrom_idx" ON "LiveRun"("documentId", "eventId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ObservedResult_documentId_eventId_idx" ON "ObservedResult"("documentId", "eventId");

-- AddForeignKey
ALTER TABLE "DocumentExport" ADD CONSTRAINT "DocumentExport_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ModelDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentExport" ADD CONSTRAINT "DocumentExport_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveRun" ADD CONSTRAINT "LiveRun_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ModelDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveRun" ADD CONSTRAINT "LiveRun_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObservedResult" ADD CONSTRAINT "ObservedResult_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ModelDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObservedResult" ADD CONSTRAINT "ObservedResult_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exports, live runs and observed results are history: never changed or removed.
CREATE TRIGGER document_export_immutable
  BEFORE UPDATE OR DELETE ON "DocumentExport"
  FOR EACH ROW EXECUTE FUNCTION revision_rows_are_immutable();

CREATE TRIGGER live_run_immutable
  BEFORE UPDATE OR DELETE ON "LiveRun"
  FOR EACH ROW EXECUTE FUNCTION revision_rows_are_immutable();

CREATE TRIGGER observed_result_immutable
  BEFORE UPDATE OR DELETE ON "ObservedResult"
  FOR EACH ROW EXECUTE FUNCTION revision_rows_are_immutable();

-- An export or a live run names a revision the document really has.
CREATE FUNCTION record_revision_exists() RETURNS trigger AS $$
BEGIN
  IF NEW.revision IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "DocumentRevision" r WHERE r."documentId" = NEW."documentId" AND r.revision = NEW.revision
  ) THEN
    RAISE EXCEPTION 'revision % of document % does not exist', NEW.revision, NEW."documentId" USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_export_revision_exists
  BEFORE INSERT ON "DocumentExport"
  FOR EACH ROW EXECUTE FUNCTION record_revision_exists();

CREATE TRIGGER live_run_revision_exists
  BEFORE INSERT ON "LiveRun"
  FOR EACH ROW EXECUTE FUNCTION record_revision_exists();
