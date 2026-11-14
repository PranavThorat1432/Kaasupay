import apiClient from './api';

export const rewardService = {
  /**
   * Fetches the user's reward cards, newest first.
   */
  async getCards() {
    const response = await apiClient.get('/api/v1/rewards');
    return response.data;
  },

  /**
   * Fetches active festival promotional offers for user awareness.
   */
  async getActiveOffers() {
    const response = await apiClient.get('/api/v1/rewards/active-offers');
    return response.data;
  },

  /**
   * Scratches and claims a specific reward card.
   * Enriches errors with status codes and network indicators for reliable UI handling.
   */
  async claimCard(cardId) {
    try {
      const response = await apiClient.post(`/api/v1/rewards/${cardId}/claim`, {});
      return response.data;
    } catch (err) {
      const status = err.response?.status;
      const isNetwork = !err.response || err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED';
      const enrichedError = new Error(
        err.response?.data?.message || err.response?.data?.error || err.message || 'Failed to claim reward card'
      );
      enrichedError.status = status;
      enrichedError.isNetworkError = isNetwork;
      enrichedError.isExpired = status === 410;
      enrichedError.isConflict = status === 409;
      enrichedError.isServerError = typeof status === 'number' && status >= 500;
      enrichedError.originalError = err;
      throw enrichedError;
    }
  },

  /**
   * Synchronizes the authoritative database state of a specific card from the backend.
   * Used to resolve ambiguous network drops or 409 conflicts without fabricating state.
   */
  async getCardById(cardId) {
    const data = await this.getCards();
    const card = data?.cards?.find((c) => String(c.id || c._id) === String(cardId));
    return card || null;
  },

  /**
   * Staff: Create a new campaign offer with promo budget deposit.
   */
  async adminCreateOffer(offerData, adminKey) {
    const response = await apiClient.post('/api/v1/admin/offers', offerData, {
      headers: { 'x-admin-key': adminKey },
    });
    return response.data;
  },

  /**
   * Staff: Get audit aggregation report for campaign offer.
   */
  async adminGetOfferReport(code, adminKey) {
    const response = await apiClient.get(`/api/v1/admin/offers/${code}`, {
      headers: { 'x-admin-key': adminKey },
    });
    return response.data;
  },

  /**
   * Staff: Stop an active campaign offer early.
   */
  async adminStopOffer(code, adminKey) {
    const response = await apiClient.post(`/api/v1/admin/offers/${code}/stop`, {}, {
      headers: { 'x-admin-key': adminKey },
    });
    return response.data;
  },

  /**
   * Staff: List all campaign offers.
   */
  async adminListOffers(adminKey) {
    const response = await apiClient.get('/api/v1/admin/offers', {
      headers: { 'x-admin-key': adminKey },
    });
    return response.data;
  },
};

export default rewardService;

