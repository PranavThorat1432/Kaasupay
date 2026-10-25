/**
 * Currency and Amount Utilities for KaasuPay
 * All internal and API amounts are integer paise (1 Rupee = 100 paise).
 */

/**
 * Formats integer paise into Indian Rupee display format
 * @param {number|string} paise - Amount in integer paise
 * @param {boolean} includeSymbol - Whether to prepend ₹ symbol (default: true)
 * @returns {string} Formatted Rupee string (e.g., "₹1,250.00")
 */
export function formatPaiseToRupees(paise, includeSymbol = true) {
  const numericPaise = Number(paise);
  if (isNaN(numericPaise)) {
    return includeSymbol ? '₹0.00' : '0.00';
  }
  const rupees = numericPaise / 100;
  
  // Format with standard Indian numbering convention (lakhs/crores) or standard 2-decimal format
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);

  return includeSymbol ? `₹${formatted}` : formatted;
}

/**
 * Converts Rupee amount (string or number) into integer paise safely
 * Rejects fractional paise (e.g., 10.005)
 * @param {number|string} rupees - Rupee amount
 * @returns {number} Integer paise
 * @throws {Error} If amount is invalid or has more than 2 decimal places
 */
export function rupeesToPaise(rupees) {
  if (rupees === null || rupees === undefined || rupees === '') {
    throw new Error('Amount is required');
  }
  const str = String(rupees).trim();
  const num = Number(str);
  if (isNaN(num) || num <= 0) {
    throw new Error('Amount must be a positive number');
  }
  
  // Check decimal places
  const parts = str.split('.');
  if (parts.length > 2 || (parts[1] && parts[1].length > 2)) {
    throw new Error('Amount cannot have more than 2 decimal places');
  }

  const paise = Math.round(num * 100);
  if (!Number.isSafeInteger(paise) || paise <= 0) {
    throw new Error('Invalid amount calculation');
  }
  return paise;
}

/**
 * Formats a transaction or event date
 * @param {string|Date} dateString 
 * @param {boolean} includeTime 
 * @returns {string} Formatted date string
 */
export function formatDateTime(dateString, includeTime = true) {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {})
  }).format(date);
}
