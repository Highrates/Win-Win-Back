-- Designer projects (ЛК комплектация), отдельно от Case

CREATE TABLE "DesignerProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignerProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DesignerProjectRoom" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "roomType" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DesignerProjectRoom_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DesignerProjectLine" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productVariantId" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'шт',
    "snapshot" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignerProjectLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DesignerProject_userId_updatedAt_idx" ON "DesignerProject"("userId", "updatedAt" DESC);

ALTER TABLE "DesignerProject" ADD CONSTRAINT "DesignerProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "DesignerProjectRoom_projectId_idx" ON "DesignerProjectRoom"("projectId");

ALTER TABLE "DesignerProjectRoom" ADD CONSTRAINT "DesignerProjectRoom_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DesignerProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "DesignerProjectLine_projectId_idx" ON "DesignerProjectLine"("projectId");
CREATE INDEX "DesignerProjectLine_roomId_idx" ON "DesignerProjectLine"("roomId");
CREATE INDEX "DesignerProjectLine_productId_idx" ON "DesignerProjectLine"("productId");
CREATE INDEX "DesignerProjectLine_productVariantId_idx" ON "DesignerProjectLine"("productVariantId");

ALTER TABLE "DesignerProjectLine" ADD CONSTRAINT "DesignerProjectLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DesignerProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DesignerProjectLine" ADD CONSTRAINT "DesignerProjectLine_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "DesignerProjectRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DesignerProjectLine" ADD CONSTRAINT "DesignerProjectLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DesignerProjectLine" ADD CONSTRAINT "DesignerProjectLine_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
