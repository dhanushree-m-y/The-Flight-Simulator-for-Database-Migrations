-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "leaveType" TEXT NOT NULL DEFAULT 'CASUAL';

-- CreateTable
CREATE TABLE "ServiceAppointment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "hostelId" TEXT,
    "serviceType" TEXT NOT NULL,
    "workerName" TEXT NOT NULL,
    "contact" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "slot" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceAppointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceAppointment_orgId_date_idx" ON "ServiceAppointment"("orgId", "date");

-- CreateIndex
CREATE INDEX "ServiceAppointment_status_idx" ON "ServiceAppointment"("status");

-- CreateIndex
CREATE INDEX "Holiday_orgId_date_idx" ON "Holiday"("orgId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_orgId_date_key" ON "Holiday"("orgId", "date");

