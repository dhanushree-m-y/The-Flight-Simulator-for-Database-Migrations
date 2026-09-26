-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'TRIAL',
    "status" TEXT NOT NULL DEFAULT 'TRIALING',
    "trialEndsAt" TIMESTAMP(3),
    "integrations" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT NOT NULL DEFAULT 'STAFF',
    "hostelId" TEXT,
    "orgId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hostel" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Hostel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Block" (
    "id" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Floor" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Floor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "floorId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DOUBLE',
    "capacity" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bed" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "isOccupied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "userId" TEXT,
    "rollNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "course" TEXT,
    "year" INTEGER,
    "guardianName" TEXT,
    "guardianPhone" TEXT,
    "address" TEXT,
    "photoUrl" TEXT,
    "admissionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "bedId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "method" TEXT,
    "dueDate" TIMESTAMP(3),
    "paidDate" TIMESTAMP(3),
    "transactionId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignedToId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'MANUAL',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visitor" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "relation" TEXT,
    "purpose" TEXT,
    "entryTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'INFO',
    "link" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "changes" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodCharge" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "hostelId" TEXT NOT NULL,
    "foodType" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoodCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeType" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubFeeType" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "feeTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubFeeType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeStructure" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "hostelId" TEXT NOT NULL,
    "feeTypeId" TEXT NOT NULL,
    "subFeeTypeId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "refundableType" TEXT NOT NULL DEFAULT 'NON_REFUNDABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Challan" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "challanNo" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "feeTypeId" TEXT NOT NULL,
    "totalFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPayable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "challanDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectionStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "generatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Challan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallanItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "challanId" TEXT NOT NULL,
    "subFeeTypeId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChallanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "receiptNo" TEXT NOT NULL,
    "challanId" TEXT NOT NULL,
    "amountPaid" DOUBLE PRECISION NOT NULL,
    "mop" TEXT NOT NULL DEFAULT 'CASH',
    "utrNo" TEXT,
    "collectionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "studentId" TEXT NOT NULL,
    "challanId" TEXT,
    "refundType" TEXT NOT NULL DEFAULT 'DEPOSIT',
    "refundAmount" DOUBLE PRECISION NOT NULL,
    "bankName" TEXT,
    "accountHolderName" TEXT,
    "branch" TEXT,
    "accountNo" TEXT,
    "ifscCode" TEXT,
    "utrNo" TEXT,
    "refundDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Uom" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Uom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstRate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "rate" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "capacity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "uomId" TEXT,
    "mrp" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gstId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grn" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "grnNo" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "grnDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "receivedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Grn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrnItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "grnId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "gstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueRegister" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "hostelId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "issuedTo" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemScrap" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "hostelId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "scrapDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "scrappedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemScrap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "poNo" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "poDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "createdById" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "poId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "gstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessBill" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "hostelId" TEXT NOT NULL,
    "billMonth" INTEGER NOT NULL,
    "billYear" INTEGER NOT NULL,
    "billDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessBillItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "messBillId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "breakfastDays" INTEGER NOT NULL DEFAULT 0,
    "lunchDays" INTEGER NOT NULL DEFAULT 0,
    "dinnerDays" INTEGER NOT NULL DEFAULT 0,
    "snackDays" INTEGER NOT NULL DEFAULT 0,
    "breakfastAmt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lunchAmt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dinnerAmt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "snackAmt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessBillItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessBillPayment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "messBillItemId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amountPaid" DOUBLE PRECISION NOT NULL,
    "mop" TEXT NOT NULL DEFAULT 'CASH',
    "utrNo" TEXT,
    "collectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessBillPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessMenu" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "hostelId" TEXT NOT NULL,
    "dayOfWeek" TEXT NOT NULL,
    "mealType" TEXT NOT NULL,
    "menuItems" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessMenu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessAttendance" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "hostelId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "attendanceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mealType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentDailyAttendance" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "studentId" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "attendanceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentDailyAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAttendance" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "hostelId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "attendanceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "punchIn" TEXT,
    "punchOut" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealPlan" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "hostelId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "breakfast" BOOLEAN NOT NULL DEFAULT true,
    "lunch" BOOLEAN NOT NULL DEFAULT true,
    "dinner" BOOLEAN NOT NULL DEFAULT true,
    "snack" BOOLEAN NOT NULL DEFAULT true,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MealPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "hostelId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "destination" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WashingMachine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "hostelId" TEXT,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WashingMachine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaundryBooking" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "machineId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "slot" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaundryBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Hostel_code_key" ON "Hostel"("code");

-- CreateIndex
CREATE INDEX "Hostel_isActive_idx" ON "Hostel"("isActive");

-- CreateIndex
CREATE INDEX "Block_hostelId_idx" ON "Block"("hostelId");

-- CreateIndex
CREATE UNIQUE INDEX "Block_hostelId_code_key" ON "Block"("hostelId", "code");

-- CreateIndex
CREATE INDEX "Floor_blockId_idx" ON "Floor"("blockId");

-- CreateIndex
CREATE UNIQUE INDEX "Floor_blockId_number_key" ON "Floor"("blockId", "number");

-- CreateIndex
CREATE INDEX "Room_floorId_idx" ON "Room"("floorId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_floorId_number_key" ON "Room"("floorId", "number");

-- CreateIndex
CREATE INDEX "Bed_roomId_idx" ON "Bed"("roomId");

-- CreateIndex
CREATE INDEX "Bed_isOccupied_idx" ON "Bed"("isOccupied");

-- CreateIndex
CREATE UNIQUE INDEX "Bed_roomId_number_key" ON "Bed"("roomId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Student_userId_key" ON "Student"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_rollNumber_key" ON "Student"("rollNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Student_email_key" ON "Student"("email");

-- CreateIndex
CREATE INDEX "Student_isActive_idx" ON "Student"("isActive");

-- CreateIndex
CREATE INDEX "Student_course_idx" ON "Student"("course");

-- CreateIndex
CREATE INDEX "Allocation_studentId_idx" ON "Allocation"("studentId");

-- CreateIndex
CREATE INDEX "Allocation_bedId_idx" ON "Allocation"("bedId");

-- CreateIndex
CREATE INDEX "Allocation_status_idx" ON "Allocation"("status");

-- CreateIndex
CREATE INDEX "Payment_studentId_idx" ON "Payment"("studentId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_type_idx" ON "Payment"("type");

-- CreateIndex
CREATE INDEX "Payment_dueDate_idx" ON "Payment"("dueDate");

-- CreateIndex
CREATE INDEX "Complaint_status_idx" ON "Complaint"("status");

-- CreateIndex
CREATE INDEX "Complaint_priority_idx" ON "Complaint"("priority");

-- CreateIndex
CREATE INDEX "Complaint_studentId_idx" ON "Complaint"("studentId");

-- CreateIndex
CREATE INDEX "Complaint_assignedToId_idx" ON "Complaint"("assignedToId");

-- CreateIndex
CREATE INDEX "Attendance_studentId_idx" ON "Attendance"("studentId");

-- CreateIndex
CREATE INDEX "Attendance_timestamp_idx" ON "Attendance"("timestamp");

-- CreateIndex
CREATE INDEX "Attendance_type_idx" ON "Attendance"("type");

-- CreateIndex
CREATE INDEX "Visitor_studentId_idx" ON "Visitor"("studentId");

-- CreateIndex
CREATE INDEX "Visitor_entryTime_idx" ON "Visitor"("entryTime");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "FoodCharge_hostelId_idx" ON "FoodCharge"("hostelId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeType_name_key" ON "FeeType"("name");

-- CreateIndex
CREATE INDEX "SubFeeType_feeTypeId_idx" ON "SubFeeType"("feeTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "SubFeeType_feeTypeId_name_key" ON "SubFeeType"("feeTypeId", "name");

-- CreateIndex
CREATE INDEX "FeeStructure_hostelId_idx" ON "FeeStructure"("hostelId");

-- CreateIndex
CREATE INDEX "FeeStructure_feeTypeId_idx" ON "FeeStructure"("feeTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "Challan_challanNo_key" ON "Challan"("challanNo");

-- CreateIndex
CREATE INDEX "Challan_studentId_idx" ON "Challan"("studentId");

-- CreateIndex
CREATE INDEX "Challan_hostelId_idx" ON "Challan"("hostelId");

-- CreateIndex
CREATE INDEX "Challan_collectionStatus_idx" ON "Challan"("collectionStatus");

-- CreateIndex
CREATE INDEX "ChallanItem_challanId_idx" ON "ChallanItem"("challanId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_receiptNo_key" ON "Receipt"("receiptNo");

-- CreateIndex
CREATE INDEX "Receipt_challanId_idx" ON "Receipt"("challanId");

-- CreateIndex
CREATE INDEX "Refund_studentId_idx" ON "Refund"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Uom_name_key" ON "Uom"("name");

-- CreateIndex
CREATE UNIQUE INDEX "GstRate_rate_key" ON "GstRate"("rate");

-- CreateIndex
CREATE INDEX "Item_name_idx" ON "Item"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Grn_grnNo_key" ON "Grn"("grnNo");

-- CreateIndex
CREATE INDEX "Grn_hostelId_idx" ON "Grn"("hostelId");

-- CreateIndex
CREATE INDEX "Grn_supplierId_idx" ON "Grn"("supplierId");

-- CreateIndex
CREATE INDEX "GrnItem_grnId_idx" ON "GrnItem"("grnId");

-- CreateIndex
CREATE INDEX "IssueRegister_hostelId_idx" ON "IssueRegister"("hostelId");

-- CreateIndex
CREATE INDEX "IssueRegister_itemId_idx" ON "IssueRegister"("itemId");

-- CreateIndex
CREATE INDEX "ItemScrap_hostelId_idx" ON "ItemScrap"("hostelId");

-- CreateIndex
CREATE INDEX "ItemScrap_itemId_idx" ON "ItemScrap"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNo_key" ON "PurchaseOrder"("poNo");

-- CreateIndex
CREATE INDEX "PurchaseOrder_hostelId_idx" ON "PurchaseOrder"("hostelId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_poId_idx" ON "PurchaseOrderItem"("poId");

-- CreateIndex
CREATE INDEX "MessBill_hostelId_idx" ON "MessBill"("hostelId");

-- CreateIndex
CREATE UNIQUE INDEX "MessBill_hostelId_billMonth_billYear_key" ON "MessBill"("hostelId", "billMonth", "billYear");

-- CreateIndex
CREATE INDEX "MessBillItem_messBillId_idx" ON "MessBillItem"("messBillId");

-- CreateIndex
CREATE INDEX "MessBillItem_studentId_idx" ON "MessBillItem"("studentId");

-- CreateIndex
CREATE INDEX "MessBillPayment_messBillItemId_idx" ON "MessBillPayment"("messBillItemId");

-- CreateIndex
CREATE INDEX "MessMenu_hostelId_idx" ON "MessMenu"("hostelId");

-- CreateIndex
CREATE INDEX "MessAttendance_hostelId_idx" ON "MessAttendance"("hostelId");

-- CreateIndex
CREATE INDEX "MessAttendance_studentId_idx" ON "MessAttendance"("studentId");

-- CreateIndex
CREATE INDEX "MessAttendance_attendanceDate_idx" ON "MessAttendance"("attendanceDate");

-- CreateIndex
CREATE INDEX "StudentDailyAttendance_hostelId_idx" ON "StudentDailyAttendance"("hostelId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentDailyAttendance_studentId_attendanceDate_key" ON "StudentDailyAttendance"("studentId", "attendanceDate");

-- CreateIndex
CREATE INDEX "StaffAttendance_hostelId_idx" ON "StaffAttendance"("hostelId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAttendance_staffId_attendanceDate_key" ON "StaffAttendance"("staffId", "attendanceDate");

-- CreateIndex
CREATE INDEX "MealPlan_hostelId_date_idx" ON "MealPlan"("hostelId", "date");

-- CreateIndex
CREATE INDEX "MealPlan_date_idx" ON "MealPlan"("date");

-- CreateIndex
CREATE UNIQUE INDEX "MealPlan_studentId_date_key" ON "MealPlan"("studentId", "date");

-- CreateIndex
CREATE INDEX "Announcement_createdAt_idx" ON "Announcement"("createdAt");

-- CreateIndex
CREATE INDEX "Announcement_audience_idx" ON "Announcement"("audience");

-- CreateIndex
CREATE INDEX "LeaveRequest_studentId_idx" ON "LeaveRequest"("studentId");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_idx" ON "LeaveRequest"("status");

-- CreateIndex
CREATE INDEX "WashingMachine_orgId_idx" ON "WashingMachine"("orgId");

-- CreateIndex
CREATE INDEX "LaundryBooking_orgId_idx" ON "LaundryBooking"("orgId");

-- CreateIndex
CREATE INDEX "LaundryBooking_studentId_idx" ON "LaundryBooking"("studentId");

-- CreateIndex
CREATE INDEX "LaundryBooking_date_idx" ON "LaundryBooking"("date");

-- CreateIndex
CREATE UNIQUE INDEX "LaundryBooking_machineId_date_slot_key" ON "LaundryBooking"("machineId", "date", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "Hostel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Floor" ADD CONSTRAINT "Floor_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bed" ADD CONSTRAINT "Bed_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallanItem" ADD CONSTRAINT "ChallanItem_challanId_fkey" FOREIGN KEY ("challanId") REFERENCES "Challan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_challanId_fkey" FOREIGN KEY ("challanId") REFERENCES "Challan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrnItem" ADD CONSTRAINT "GrnItem_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "Grn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessBillItem" ADD CONSTRAINT "MessBillItem_messBillId_fkey" FOREIGN KEY ("messBillId") REFERENCES "MessBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessBillPayment" ADD CONSTRAINT "MessBillPayment_messBillItemId_fkey" FOREIGN KEY ("messBillItemId") REFERENCES "MessBillItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlan" ADD CONSTRAINT "MealPlan_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaundryBooking" ADD CONSTRAINT "LaundryBooking_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "WashingMachine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

