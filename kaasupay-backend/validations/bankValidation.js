import { z } from "zod";
import mongoose from "mongoose";

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NUMBER_REGEX = /^\d{9,18}$/;

export const bankAccountSchema = z
  .object({
    holderName: z
      .string({ required_error: "holderName is required" })
      .trim()
      .min(2, "holderName must be at least 2 characters")
      .max(60, "holderName must be at most 60 characters"),
    accountNumber: z
      .string({ required_error: "accountNumber is required" })
      .trim()
      .regex(ACCOUNT_NUMBER_REGEX, "accountNumber: must be 9 to 18 digits"),
    ifsc: z
      .string({ required_error: "ifsc is required" })
      .trim()
      .transform((val) => val.toUpperCase())
      .refine((val) => IFSC_REGEX.test(val), {
        message: "ifsc: is not a valid IFSC",
      }),
  })
  .strict();

export const withdrawSchema = z
  .object({
    bankAccountId: z
      .string({ required_error: "bankAccountId is required" })
      .refine((val) => mongoose.isValidObjectId(val), {
        message: "bankAccountId must be a valid ObjectId",
      }),
    amount: z
      .number({ required_error: "amount is required" })
      .int("amount must be an integer (paise)")
      .min(10000, "amount: must be at least 10000 paise")
      .max(2500000, "amount: must be at most 2500000 paise"),
    pin: z.string().optional(),
  })
  .strict();
