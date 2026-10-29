// test/phase1_model_validation.test.js — Acceptance test for Phase 1 Data Model & Validations.
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import MoneyRequest from "../models/moneyRequestModel.js";
import { REQUEST_EXPIRY_DAYS } from "../config.js";
import {
  createRequestSchema,
  payRequestSchema,
  requestIdParamSchema,
} from "../validations/requestValidation.js";

let passed = 0;
let failed = 0;

function check(desc, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`PASS  ${desc}`);
  } else {
    failed++;
    console.error(`FAIL  ${desc} ${extra}`);
  }
}

async function run() {
  console.log("=== Phase 1 Model & Validation Test Suite ===");

  // 1. Config verification
  check("REQUEST_EXPIRY_DAYS is configured as 7", REQUEST_EXPIRY_DAYS === 7);

  // 2. Schema structure & indexes
  const schema = MoneyRequest.schema;
  const paths = schema.paths;
  check("requesterId path exists in schema", Boolean(paths.requesterId));
  check("payerId path exists in schema", Boolean(paths.payerId));
  check("amount path exists in schema", Boolean(paths.amount));
  check("status path exists in schema", Boolean(paths.status));
  check("expiresAt path exists in schema", Boolean(paths.expiresAt));
  check("transactionId path exists in schema", Boolean(paths.transactionId));
  check("decidedAt path exists in schema", Boolean(paths.decidedAt));

  const statusEnum = paths.status.enumValues;
  check(
    "status enum has exact 5 states",
    Array.isArray(statusEnum) &&
      statusEnum.includes("PENDING") &&
      statusEnum.includes("PAID") &&
      statusEnum.includes("DECLINED") &&
      statusEnum.includes("CANCELLED") &&
      statusEnum.includes("EXPIRED") &&
      statusEnum.length === 5
  );

  const indexes = schema.indexes();
  const hasIncomingIndex = indexes.some(
    ([fields]) => fields.payerId === 1 && fields.status === 1 && fields.createdAt === -1
  );
  const hasOutgoingIndex = indexes.some(
    ([fields]) => fields.requesterId === 1 && fields.status === 1 && fields.createdAt === -1
  );
  const hasSpamIndex = indexes.some(
    ([fields]) => fields.requesterId === 1 && fields.payerId === 1 && fields.status === 1
  );

  check("has compound index for incoming inbox (payerId, status, createdAt)", hasIncomingIndex);
  check("has compound index for outgoing inbox (requesterId, status, createdAt)", hasOutgoingIndex);
  check("has compound index for spam check (requesterId, payerId, status)", hasSpamIndex);

  // 3. Zod createRequestSchema validation checks
  const validPayload = {
    to: "507f1f77bcf86cd799439011",
    amount: 50000,
    note: "Dinner at Murugan Idli",
  };

  const parsedValid = createRequestSchema.safeParse(validPayload);
  check("createRequestSchema accepts valid payload", parsedValid.success);

  const minBound = createRequestSchema.safeParse({ to: "507f1f77bcf86cd799439011", amount: 100 });
  check("createRequestSchema accepts minimum 100 paise", minBound.success);

  const maxBound = createRequestSchema.safeParse({ to: "507f1f77bcf86cd799439011", amount: 1000000 });
  check("createRequestSchema accepts maximum 1,000,000 paise", maxBound.success);

  const belowMin = createRequestSchema.safeParse({ to: "507f1f77bcf86cd799439011", amount: 99 });
  check("createRequestSchema rejects amount < 100 paise", !belowMin.success);

  const aboveMax = createRequestSchema.safeParse({ to: "507f1f77bcf86cd799439011", amount: 1000001 });
  check("createRequestSchema rejects amount > 1,000,000 paise", !aboveMax.success);

  const fractional = createRequestSchema.safeParse({ to: "507f1f77bcf86cd799439011", amount: 100.5 });
  check("createRequestSchema rejects fractional paise", !fractional.success);

  const negative = createRequestSchema.safeParse({ to: "507f1f77bcf86cd799439011", amount: -500 });
  check("createRequestSchema rejects negative amount", !negative.success);

  const stringAmt = createRequestSchema.safeParse({ to: "507f1f77bcf86cd799439011", amount: "500" });
  check("createRequestSchema rejects string amount", !stringAmt.success);

  const invalidObjectId = createRequestSchema.safeParse({ to: "invalid-user-id", amount: 500 });
  check("createRequestSchema rejects non-hex ObjectId", !invalidObjectId.success);

  const longNote = createRequestSchema.safeParse({
    to: "507f1f77bcf86cd799439011",
    amount: 500,
    note: "a".repeat(101),
  });
  check("createRequestSchema rejects note exceeding 100 characters", !longNote.success);

  const extraField = createRequestSchema.safeParse({
    to: "507f1f77bcf86cd799439011",
    amount: 500,
    status: "PAID",
  });
  check("createRequestSchema rejects extra unexpected fields (strict schema)", !extraField.success);

  // 4. Zod payRequestSchema validation checks
  check("payRequestSchema accepts 4-digit PIN", payRequestSchema.safeParse({ pin: "5829" }).success);
  check("payRequestSchema accepts 6-digit PIN", payRequestSchema.safeParse({ pin: "123456" }).success);
  check("payRequestSchema rejects 3-digit PIN", !payRequestSchema.safeParse({ pin: "123" }).success);
  check("payRequestSchema rejects 5-digit PIN", !payRequestSchema.safeParse({ pin: "12345" }).success);
  check("payRequestSchema rejects non-numeric PIN", !payRequestSchema.safeParse({ pin: "12a4" }).success);
  check("payRequestSchema rejects missing PIN", !payRequestSchema.safeParse({}).success);

  // 5. In-Memory Database document persistence test
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: "kaasupay_test_p1" });

    const testReq = await MoneyRequest.create({
      requesterId: new mongoose.Types.ObjectId(),
      payerId: new mongoose.Types.ObjectId(),
      amount: 50000,
      note: "Lunch bill",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    check("MoneyRequest persists successfully in MongoDB", Boolean(testReq._id));
    check("MoneyRequest default status is PENDING", testReq.status === "PENDING");
    check("MoneyRequest transactionId defaults to null", testReq.transactionId === null);
    check("MoneyRequest decidedAt defaults to null", testReq.decidedAt === null);
    check("MoneyRequest has createdAt and updatedAt timestamps", Boolean(testReq.createdAt && testReq.updatedAt));

    await mongoose.disconnect();
  } finally {
    await mongod.stop();
  }

  console.log(`\nPHASE 1 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
