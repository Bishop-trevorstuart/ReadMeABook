-- AlterTable
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'audiobook';
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "parent_request_id" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "requests_type_idx" ON "requests"("type");
CREATE INDEX IF NOT EXISTS "requests_parent_request_id_idx" ON "requests"("parent_request_id");

-- AddForeignKey (with ON DELETE SET NULL)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'requests_parent_request_id_fkey'
    ) THEN
        ALTER TABLE "requests" ADD CONSTRAINT "requests_parent_request_id_fkey"
        FOREIGN KEY ("parent_request_id") REFERENCES "requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
