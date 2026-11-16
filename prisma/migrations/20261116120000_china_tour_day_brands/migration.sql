-- CreateTable
CREATE TABLE "ChinaTourDayBrand" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "brandId" TEXT,
    "customName" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChinaTourDayBrand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChinaTourDayBrand_dayId_sortOrder_idx" ON "ChinaTourDayBrand"("dayId", "sortOrder");

-- CreateIndex
CREATE INDEX "ChinaTourDayBrand_brandId_idx" ON "ChinaTourDayBrand"("brandId");

-- AddForeignKey
ALTER TABLE "ChinaTourDayBrand" ADD CONSTRAINT "ChinaTourDayBrand_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "ChinaTourDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChinaTourDayBrand" ADD CONSTRAINT "ChinaTourDayBrand_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
