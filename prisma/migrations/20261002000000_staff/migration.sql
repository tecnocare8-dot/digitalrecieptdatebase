-- CreateTable
CREATE TABLE "app"."Staff" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "loginId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Staff_loginId_key" ON "app"."Staff"("loginId");

-- CreateIndex
CREATE INDEX "Staff_ownerId_idx" ON "app"."Staff"("ownerId");

-- AddForeignKey
ALTER TABLE "app"."Staff" ADD CONSTRAINT "Staff_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "app"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

