import apiClient from './api';

export const authService = {
  /**
   * Register a new user and create their initial wallet
   * @param {{ username: string, firstName: string, lastName: string, password: string }} data
   */
  async signup(data) {
    const response = await apiClient.post('/api/v1/user/signup', data);
    return response.data;
  },

  /**
   * Authenticate an existing user and obtain a JWT
   * @param {{ username: string, password: string }} credentials
   */
  async signin(credentials) {
    const response = await apiClient.post('/api/v1/user/signin', credentials);
    return response.data;
  },

  /**
   * Retrieve the current authenticated user's profile
   */
  async getMe() {
    const response = await apiClient.get('/api/v1/user/me');
    return response.data;
  },

  /**
   * Update the user profile (firstName, lastName, or password)
   * @param {{ firstName?: string, lastName?: string, password?: string }} updates
   */
  async updateProfile(updates) {
    const response = await apiClient.put('/api/v1/user', updates);
    return response.data;
  },

  /**
   * Search users for transfer recipient auto-complete
   * @param {string} filter
   */
  async searchUsers(filter = '') {
    const response = await apiClient.get('/api/v1/user/bulk', {
      params: { filter },
    });
    return response.data;
  },

  // ---------------------------------------------------------------------------
  // Day 6: Security, Payment PIN & Session Management
  // ---------------------------------------------------------------------------

  /**
   * Set or update payment PIN with password verification
   * @param {{ pin: string, password: string }} data
   * @returns {Promise<{ message: string, hasPin: boolean }>}
   */
  async setPin(data) {
    const response = await apiClient.post('/api/v1/user/pin', data);
    return response.data;
  },

  /**
   * Invalidate all active sessions across all devices
   * @returns {Promise<{ message: string }>}
   */
  async logoutAll() {
    const response = await apiClient.post('/api/v1/user/logout-all');
    return response.data;
  },
};

export default authService;
