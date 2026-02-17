-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT,
    "address" JSONB,
    "materials_offered" JSONB NOT NULL DEFAULT '[]',
    "meta" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_matches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "extraction_result_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "confidence_score" DOUBLE PRECISION,
    "match_reason" TEXT,
    "match_metadata" JSONB NOT NULL DEFAULT '{}',
    "is_selected" BOOLEAN NOT NULL DEFAULT false,
    "selected_by" UUID,
    "selected_at" TIMESTAMPTZ(6),
    "email_sent" BOOLEAN NOT NULL DEFAULT false,
    "email_sent_at" TIMESTAMPTZ(6),
    "meta" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "supplier_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_organization_id_idx" ON "suppliers"("organization_id");

-- CreateIndex
CREATE INDEX "suppliers_contact_email_idx" ON "suppliers"("contact_email");

-- CreateIndex
CREATE INDEX "suppliers_materials_offered_idx" ON "suppliers" USING GIN ("materials_offered");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_matches_extraction_result_id_supplier_id_key" ON "supplier_matches"("extraction_result_id", "supplier_id");

-- CreateIndex
CREATE INDEX "supplier_matches_extraction_result_id_idx" ON "supplier_matches"("extraction_result_id");

-- CreateIndex
CREATE INDEX "supplier_matches_supplier_id_idx" ON "supplier_matches"("supplier_id");

-- CreateIndex
CREATE INDEX "supplier_matches_is_selected_idx" ON "supplier_matches"("is_selected");

-- CreateIndex
CREATE INDEX "supplier_matches_confidence_score_idx" ON "supplier_matches"("confidence_score");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_matches" ADD CONSTRAINT "supplier_matches_extraction_result_id_fkey" FOREIGN KEY ("extraction_result_id") REFERENCES "extraction_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_matches" ADD CONSTRAINT "supplier_matches_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_matches" ADD CONSTRAINT "supplier_matches_selected_by_fkey" FOREIGN KEY ("selected_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
