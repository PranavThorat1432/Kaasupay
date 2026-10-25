import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export const TOKEN_STORAGE_KEY = 'kaasupay_jwt_token';
export const USER_STORAGE_KEY = 'kaasupay_user_profile';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

/**
 * Request Interceptor: Attach JWT Bearer token if present
 */
apiClient.interceptors.request.use(
  (config) => {
    try {
      const token = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // Ignore localStorage access issues in restricted contexts
    }
    return config;
  },
  (error) => Promise.reject(error)
);

/**
 * Response Interceptor: Safe handling of 401 Unauthorized and standardizing errors
 */
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Check if status is 401 Unauthorized
    if (error.response && error.response.status === 401) {
      try {
        // Clear stored session
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        localStorage.removeItem(USER_STORAGE_KEY);
        
        // Dispatch custom event for Redux store or Auth listeners to sync state cleanly
        window.dispatchEvent(new CustomEvent('kaasupay:auth_unauthorized'));
      } catch {
        // Ignore storage clear errors
      }
    }

    // Standardize error message for callers
    const message =
      error.response?.data?.error ||
      error.response?.data?.message ||
      (error.response?.status === 404 ? 'Resource not found' : null) ||
      (error.response?.status === 502 ? 'Payment gateway communication failure' : null) ||
      error.message ||
      'An unexpected network error occurred';

    const enhancedError = new Error(message);
    enhancedError.status = error.response?.status;
    enhancedError.data = error.response?.data;
    enhancedError.isNetworkError = !error.response;

    return Promise.reject(enhancedError);
  }
);

export default apiClient;
