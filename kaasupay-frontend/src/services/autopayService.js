import apiClient from './api';

export const autopayService = {
  /**
   * Fetches all AutoPay mandates created by the authenticated user as payer.
   * @returns {Promise<{ mandates: Array }>}
   */
  async getMandates() {
    const response = await apiClient.get('/api/v1/autopay');
    return response.data;
  },

  /**
   * Sets up a new AutoPay mandate with PIN step-up authentication.
   * @param {object} params
   * @param {string} params.to - Recipient user ObjectId
   * @param {number} params.amount - Integer paise (100 to 500000)
   * @param {number} params.dayOfMonth - Integer (1 to 28)
   * @param {string} params.pin - Payer payment PIN
   * @returns {Promise<{ message: string, mandate: object }>}
   */
  async createMandate({ to, amount, dayOfMonth, pin }) {
    const response = await apiClient.post('/api/v1/autopay', {
      to,
      amount,
      dayOfMonth,
      pin,
    });
    return response.data;
  },

  /**
   * Retrieves chronological execution history runs for a single mandate.
   * @param {string} id - Mandate ObjectId
   * @returns {Promise<{ runs: Array }>}
   */
  async getMandateRuns(id) {
    const response = await apiClient.get(`/api/v1/autopay/${id}/runs`);
    return response.data;
  },

  /**
   * Pauses an active mandate.
   * @param {string} id - Mandate ObjectId
   * @returns {Promise<{ message: string }>}
   */
  async pauseMandate(id) {
    const response = await apiClient.post(`/api/v1/autopay/${id}/pause`, {});
    return response.data;
  },

  /**
   * Resumes a paused mandate and recalculates next scheduled date.
   * @param {string} id - Mandate ObjectId
   * @returns {Promise<{ message: string, nextRunDay: string }>}
   */
  async resumeMandate(id) {
    const response = await apiClient.post(`/api/v1/autopay/${id}/resume`, {});
    return response.data;
  },

  /**
   * Permanently cancels an active or paused mandate.
   * @param {string} id - Mandate ObjectId
   * @returns {Promise<{ message: string }>}
   */
  async cancelMandate(id) {
    const response = await apiClient.post(`/api/v1/autopay/${id}/cancel`, {});
    return response.data;
  },
};

export default autopayService;
