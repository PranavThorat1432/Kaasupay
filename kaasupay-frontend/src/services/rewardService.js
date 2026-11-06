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
   */
  async claimCard(cardId) {
    const response = await apiClient.post(`/api/v1/rewards/${cardId}/claim`, {});
    return response.data;
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

