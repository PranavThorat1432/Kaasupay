// All runtime configuration comes from environment variables (.env is loaded
// by dotenv in index.js before this module is imported).
// The app fails fast with a clear message instead of falling back to a
// hard-coded secret, so a missing value can never ship silently.

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    console.error("Fill it in .env (see .env.example) and start the server again.");
    process.exit(1);
  }
  return value;
}

// JWT secret used to sign and verify tokens (Day 2: never in source code).
export const JWT_SECRET = requireEnv("JWT_SECRET");

// MongoDB connection string (Atlas or local).
export const MONGO_URL = requireEnv("MONGO_URL");

// Staff-only key for admin endpoints (Day 3). A real secret must be set in
// .env — this is a simplified educational mechanism, not full RBAC.
export const ADMIN_KEY = requireEnv("ADMIN_KEY");

// Port is optional - 3000 is the default.
export const PORT = process.env.PORT || 3000;

// Frontend origin for CORS (defaults to http://localhost:5173).
export const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

// Core Banking URL (Day 5 - used by Payout Worker)
export const BANK_URL = process.env.BANK_URL || "http://localhost:4000";

// Razorpay credentials (Day 4 - API-specific).
// In production, missing credentials fail fast when validateApiConfig() is called by the API.
// In development/testing, an explicit check is made so Day 2 & Day 3 features remain testable without payment keys.
const rawRazorpayKeyId = process.env.RAZORPAY_KEY_ID;
const rawRazorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
const rawRazorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

export const isRazorpayConfigured = Boolean(
  rawRazorpayKeyId && rawRazorpayKeySecret && rawRazorpayWebhookSecret
);

export const RAZORPAY_KEY_ID = rawRazorpayKeyId || "";
export const RAZORPAY_KEY_SECRET = rawRazorpayKeySecret || "";
export const RAZORPAY_WEBHOOK_SECRET = rawRazorpayWebhookSecret || "";

export function assertRazorpayConfigured() {
  if (!isRazorpayConfigured) {
    const error = new Error(
      "Razorpay payment credentials are not configured. Please set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_WEBHOOK_SECRET in .env."
    );
    error.status = 503;
    throw error;
  }
}

/**
 * Validates API-specific configuration (such as Razorpay credentials in production).
 * Called by the backend API entry point (index.js) during startup.
 * Keeps worker processes free from requiring payment credentials.
 */
export function validateApiConfig() {
  if (process.env.NODE_ENV === "production" && !isRazorpayConfigured) {
    console.error("Missing required Razorpay payment credentials in production.");
    console.error("Please configure RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_WEBHOOK_SECRET in .env.");
    process.exit(1);
  }
}


