const axios = require('axios');

const ML_API = 'https://api.mercadolibre.com';
const ML_AUTH = 'https://auth.mercadolivre.com.br';

class MercadoLivreService {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.client = axios.create({
      baseURL: ML_API,
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  }

  // =============================================
  // AUTENTICAÇÃO
  // =============================================
  static getAuthUrl(state) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.ML_CLIENT_ID,
      redirect_uri: process.env.ML_REDIRECT_URI,
      state
    });
    return `${ML_AUTH}/authorization?${params}`;
  }

  static async exchangeCode(code) {
    const response = await axios.post(`${ML_API}/oauth/token`, {
      grant_type: 'authorization_code',
      client_id: process.env.ML_CLIENT_ID,
      client_secret: process.env.ML_CLIENT_SECRET,
      code,
      redirect_uri: process.env.ML_REDIRECT_URI
    }, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return response.data;
  }

  static async refreshToken(refreshToken) {
    const response = await axios.post(`${ML_API}/oauth/token`, {
      grant_type: 'refresh_token',
      client_id: process.env.ML_CLIENT_ID,
      client_secret: process.env.ML_CLIENT_SECRET,
      refresh_token: refreshToken
    }, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return response.data;
  }

  // =============================================
  // USUÁRIO
  // =============================================
  async getMe() {
    const res = await this.client.get('/users/me');
    return res.data;
  }

  // =============================================
  // VENDAS / ORDERS
  // =============================================
  async getOrders(sellerId, params = {}) {
    const defaults = {
      seller: sellerId,
      sort: 'date_desc',
      limit: 50,
      offset: 0
    };
    const query = { ...defaults, ...params };
    const res = await this.client.get('/orders/search', { params: query });
    return res.data;
  }

  async getOrderById(orderId) {
    const res = await this.client.get(`/orders/${orderId}`);
    return res.data;
  }

  async getOrdersByDateRange(sellerId, dateFrom, dateTo, offset = 0) {
    const res = await this.client.get('/orders/search', {
      params: {
        seller: sellerId,
        'order.date_created.from': dateFrom,
        'order.date_created.to': dateTo,
        sort: 'date_desc',
        limit: 50,
        offset
      }
    });
    return res.data;
  }

  // =============================================
  // ANÚNCIOS / ITEMS
  // =============================================
  async getMyItems(sellerId, params = {}) {
    const defaults = { limit: 50, offset: 0 };
    const query = { ...defaults, ...params };
    const res = await this.client.get(`/users/${sellerId}/items/search`, { params: query });
    return res.data;
  }

  async getItemById(itemId) {
    const res = await this.client.get(`/items/${itemId}`);
    return res.data;
  }

  async getItemsMulti(itemIds) {
    const ids = itemIds.join(',');
    const res = await this.client.get(`/items?ids=${ids}`);
    return res.data;
  }

  async updateItem(itemId, data) {
    const res = await this.client.put(`/items/${itemId}`, data);
    return res.data;
  }

  async pauseItem(itemId) {
    return this.updateItem(itemId, { status: 'paused' });
  }

  async activateItem(itemId) {
    return this.updateItem(itemId, { status: 'active' });
  }

  async updateItemPrice(itemId, price) {
    return this.updateItem(itemId, { price });
  }

  async updateItemStock(itemId, availableQuantity) {
    return this.updateItem(itemId, { available_quantity: availableQuantity });
  }

  async getItemVisits(itemId, dateFrom, dateTo) {
    const res = await this.client.get(`/items/${itemId}/visits/time_window`, {
      params: {
        last: 30,
        unit: 'day',
        ending: dateTo || new Date().toISOString().split('T')[0]
      }
    });
    return res.data;
  }

  // =============================================
  // FINANCEIRO / BILLING
  // =============================================
  async getBillingInfo(userId) {
    const res = await this.client.get(`/users/${userId}/mercadopago_account/movements`, {
      params: { limit: 50 }
    });
    return res.data;
  }

  async getSellerCharges(userId, params = {}) {
    const res = await this.client.get(`/users/${userId}/seller_charges`, {
      params: { limit: 50, ...params }
    });
    return res.data;
  }

  // =============================================
  // MENSAGENS / PERGUNTAS
  // =============================================
  async getQuestions(itemId, params = {}) {
    const res = await this.client.get('/questions/search', {
      params: { item: itemId, ...params }
    });
    return res.data;
  }

  async answerQuestion(questionId, text) {
    const res = await this.client.post(`/answers`, { question_id: questionId, text });
    return res.data;
  }

  async getMessages(packId) {
    const res = await this.client.get(`/messages/packs/${packId}/sellers/me`);
    return res.data;
  }

  async sendMessage(packId, text) {
    const res = await this.client.post(`/messages/packs/${packId}/sellers/me`, {
      text
    });
    return res.data;
  }

  // =============================================
  // REPUTAÇÃO
  // =============================================
  async getReputation(userId) {
    const res = await this.client.get(`/users/${userId}/seller_reputation`);
    return res.data;
  }

  // =============================================
  // CATEGORIAS E TENDÊNCIAS
  // =============================================
  async getTrends(categoryId) {
    const res = await this.client.get(`/trends/MLB/${categoryId}`);
    return res.data;
  }

  async searchItems(query, params = {}) {
    const res = await this.client.get('/sites/MLB/search', {
      params: { q: query, limit: 50, ...params }
    });
    return res.data;
  }

  async getCategories() {
    const res = await this.client.get('/sites/MLB/categories');
    return res.data;
  }
}

module.exports = MercadoLivreService;
