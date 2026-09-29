-- CreateTable
CREATE TABLE "InvoiceIssuer" (
    "invoiceNumber" TEXT NOT NULL PRIMARY KEY,
    "legalName" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
