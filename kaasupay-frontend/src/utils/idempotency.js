/**
 * Generates a unique, RFC-compliant or cryptographically secure idempotency key
 * For wallet transfers and financial operations to prevent duplicate executions.
 */
export function generateIdempotencyKey(prefix = 'tx') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  // Fallback for environments lacking crypto.randomUUID
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${timestamp}_${randomStr}`;
}
