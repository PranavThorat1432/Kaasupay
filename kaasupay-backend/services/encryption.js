// services/encryption.js — AES-256-GCM encryption for sensitive bank account numbers (Bonus 7)
import crypto from "node:crypto";
import dotenv from "dotenv";

dotenv.config();

// Derive a guaranteed 32-byte (256-bit) key from environment
function getEncryptionKey() {
  const secret =
    process.env.BANK_ENCRYPTION_KEY ||
    "kaasupay-default-secret-encryption-key-for-bank-details-32b";
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypts an account number using AES-256-GCM with a synthetic IV
 * so that identical account numbers produce identical ciphertexts,
 * enabling MongoDB unique compound indexes ({ userId: 1, accountNumber: 1 })
 * to enforce duplicate account prevention directly at the database level.
 *
 * Output format: "iv:authTag:ciphertext" (all hex encoded)
 *
 * @param {string} text - Plain text account number
 * @returns {string} Encrypted string
 */
export function encryptAccountNumber(text) {
  if (!text) return text;
  // If already encrypted, return as is
  if (text.includes(":") && text.split(":").length === 3) {
    return text;
  }

  const key = getEncryptionKey();
  // Synthetic 12-byte IV derived from HMAC of input with key (deterministic AES-GCM)
  const iv = crypto.createHmac("sha256", key).update(text).digest().subarray(0, 12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an encrypted account number using AES-256-GCM.
 *
 * @param {string} encryptedText - "iv:authTag:ciphertext" or plain fallback
 * @returns {string} Plain text account number
 */
export function decryptAccountNumber(encryptedText) {
  if (!encryptedText) return encryptedText;
  const parts = encryptedText.split(":");
  if (parts.length !== 3) {
    return encryptedText;
  }

  try {
    const [ivHex, authTagHex, cipherHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(cipherHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.error("Failed to decrypt bank account number:", err.message);
    throw new Error("Failed to decrypt bank account details");
  }
}

/**
 * Hashes an account number deterministically using SHA-256.
 *
 * @param {string} text - Plain text account number
 * @returns {string} SHA-256 hex digest
 */
export function hashAccountNumber(text) {
  if (!text) return "";
  return crypto.createHash("sha256").update(text.trim()).digest("hex");
}
