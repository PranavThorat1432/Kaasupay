import { z } from "zod";

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

export const createMandateSchema = z.object({
  to: z
    .string({
      required_error: "Recipient ID is required",
      invalid_type_error: "Recipient ID must be a string",
    })
    .regex(OBJECT_ID_REGEX, "Recipient ID must be a valid 24-character hexadecimal ObjectId"),
  amount: z
    .number({
      required_error: "Amount is required",
      invalid_type_error: "Amount must be a number",
    })
    .int("Amount must be an integer number of paise")
    .min(100, "Minimum amount is ₹1 (100 paise)")
    .max(500000, "Maximum amount is ₹5,000 (500000 paise)"),
  dayOfMonth: z
    .number({
      required_error: "dayOfMonth is required",
      invalid_type_error: "dayOfMonth must be a number",
    })
    .int("dayOfMonth must be an integer")
    .min(1, "dayOfMonth must be at least 1")
    .max(28, "dayOfMonth must be at most 28"),
  pin: z
    .string({
      required_error: "Payment PIN is required",
      invalid_type_error: "Payment PIN must be a string",
    })
    .min(1, "PIN cannot be empty"),
});
