/*
  Warnings:

  - You are about to drop the `Receipt` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "app"."Receipt" DROP CONSTRAINT "Receipt_userId_fkey";

-- AlterTable
ALTER TABLE "app"."User" ADD COLUMN     "driveFolderId" TEXT,
ADD COLUMN     "driveFolderName" TEXT,
ADD COLUMN     "googleRefreshToken" TEXT;

-- DropTable
DROP TABLE "app"."Receipt";
