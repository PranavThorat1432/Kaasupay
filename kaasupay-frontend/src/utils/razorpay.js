/**
 * Helper to dynamically load the Razorpay Checkout script if not already present on window.
 * Returns a Promise that resolves to true when window.Razorpay is available.
 */
let razorpayScriptPromise = null;

export function loadRazorpayScript() {
  if (typeof window === 'undefined') {
    return Promise.resolve(false);
  }

  if (window.Razorpay) {
    return Promise.resolve(true);
  }

  if (razorpayScriptPromise) {
    return razorpayScriptPromise;
  }

  razorpayScriptPromise = new Promise((resolve) => {
    const existingScript = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(true));
      existingScript.addEventListener('error', () => resolve(false));
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;

    script.onload = () => resolve(true);
    script.onerror = () => {
      console.warn('Unable to load external Razorpay script (network blocked or offline).');
      resolve(false);
    };

    document.head.appendChild(script);
  });

  return razorpayScriptPromise;
}

export default loadRazorpayScript;
