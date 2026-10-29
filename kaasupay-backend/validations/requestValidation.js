// validations/requestValidation.js — Zod schemas for Day 7 Request Money operations.
import { z } from "zod";

/**
 * Validates 24-character hexadecimal MongoDB ObjectId strings.
 */
export const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const objectIdSchema = z
  .string({ error: "id must be a string" })
  .trim()
  .regex(objectIdRegex, { message: "Invalid user id" });

/**
 * Schema for POST /api/v1/requests (Create Money Request)
 *
 * Rules:
 * - to: valid 24-hex MongoDB user ObjectId
 * - amount: whole number integer paise from 100 to 1,000,000 (₹1.00 to ₹10,000.00)
 * - note: optional string, max 100 characters
 */
export const createRequestSchema = z
  .object({
    to: z
      .string({ error: "to is required" })
      .trim()
      .regex(objectIdRegex, { message: "to must be a valid user id" }),
    amount: z
      .number({ error: "amount must be a number" })
      .int({ message: "amount must be an integer" })
      .min(100, { message: "amount must be at least 100 paise (₹1)" })
      .max(1000000, { message: "amount must be at most 1000000 paise (₹10,000)" }),
    note: z
      .string()
      .max(100, { message: "note must be at most 100 characters" })
      .optional()
      .nullable(),
  })
  .strict();

/**
 * Schema for POST /api/v1/requests/:id/pay
 *
 * Rules:
 * - pin: 4 or 6 numeric digits
 */
export const payRequestSchema = z
  .object({
    pin: z
      .string({ error: "PIN is required" })
      .regex(/^\d{4}$|^\d{6}$/, { message: "PIN must be 4 or 6 digits" }),
  })
  .strict();

/**
 * Schema for request route parameter: :id
 */
export const requestIdParamSchema = z
  .object({
    id: z
      .string({ error: "id parameter is required" })
      .trim()
      .regex(objectIdRegex, { message: "Invalid request id" }),
  });
