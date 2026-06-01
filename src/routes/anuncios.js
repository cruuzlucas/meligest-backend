const express = require('express');
const router = express.Router();
const { pool } = require('../services/database');
const MercadoLivreService = require('../services/mercadolivre');

async function getMlService(userId) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  const user = result.rows[0];
  if (!user) throw new Error('Usuário não encontrado');
  return { service: new MercadoLivreService(user.ml_access_token), user };
}

// Lista todos os anúncios
router.get('/', async (req, res) => {
  try {
    const { service, user } = await getMlService(req.user.userId);
    const { offset = 0, status } = req.query;
    const params = { offset: parseInt(offset) };
    if (status) params.status = status;

    const search = await service.getMyItems(user.ml_user_id, params);
    const itemIds = search.results || [];

    if (itemIds.length === 0) {
      return res.json({ total: 0, items: [], paging: search.paging });
    }

    // Busca detalhes em batch (máx 20 por request)
    const batches = [];
    for (let i = 0; i < itemIds.length; i += 20) {
      batches.push(itemIds.slice(i, i + 20));
    }

    const items = [];
    for (const batch of batches) {
      const details = await service.getItemsMulti(batch);
      details.forEach(d => {
        if (d.code === 200) items.push(d.body);
      });
    }

    // Busca custos cadastrados
    const costsResult = await pool.query(
      'SELECT item_id, cost_price, sku FROM product_costs WHERE user_id = $1',
      [req.user.userId]
    );
    const costsMap = {};
    costsResult.rows.forEach(c => { costsMap[c.item_id] = c; });

    const enrichedItems = items.map(item => ({
      ...item,
      custo: costsMap[item.id]?.cost_price || 0,
      sku: costsMap[item.id]?.sku || ''
    }));

    res.json({ total: search.paging?.total || 0, items: enrichedItems, paging: search.paging });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Erro ao buscar anúncios' });
  }
});

// Detalhe de anúncio
router.get('/:itemId', async (req, res) => {
  try {
    const { service } = await getMlService(req.user.userId);
    const item = await service.getItemById(req.params.itemId);
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar anúncio' });
  }
});

// Pausar anúncio
router.patch('/:itemId/pausar', async (req, res) => {
  try {
    const { service } = await getMlService(req.user.userId);
    const result = await service.pauseItem(req.params.itemId);
    res.json({ success: true, item: result });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao pausar anúncio' });
  }
});

// Ativar anúncio
router.patch('/:itemId/ativar', async (req, res) => {
  try {
    const { service } = await getMlService(req.user.userId);
    const result = await service.activateItem(req.params.itemId);
    res.json({ success: true, item: result });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao ativar anúncio' });
  }
});

// Atualizar preço
router.patch('/:itemId/preco', async (req, res) => {
  try {
    const { service } = await getMlService(req.user.userId);
    const { price } = req.body;
    if (!price || price <= 0) return res.status(400).json({ error: 'Preço inválido' });
    const result = await service.updateItemPrice(req.params.itemId, parseFloat(price));
    res.json({ success: true, item: result });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar preço' });
  }
});

// Atualizar estoque
router.patch('/:itemId/estoque', async (req, res) => {
  try {
    const { service } = await getMlService(req.user.userId);
    const { quantity } = req.body;
    if (quantity === undefined || quantity < 0) return res.status(400).json({ error: 'Quantidade inválida' });
    const result = await service.updateItemStock(req.params.itemId, parseInt(quantity));
    res.json({ success: true, item: result });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar estoque' });
  }
});

// Cadastrar/atualizar custo do produto
router.post('/:itemId/custo', async (req, res) => {
  try {
    const { cost_price, sku } = req.body;
    await pool.query(`
      INSERT INTO product_costs (user_id, item_id, cost_price, sku)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, item_id) DO UPDATE SET
        cost_price = EXCLUDED.cost_price,
        sku = EXCLUDED.sku,
        updated_at = NOW()
    `, [req.user.userId, req.params.itemId, cost_price || 0, sku || '']);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar custo' });
  }
});

// Perguntas de um anúncio
router.get('/:itemId/perguntas', async (req, res) => {
  try {
    const { service } = await getMlService(req.user.userId);
    const questions = await service.getQuestions(req.params.itemId);
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar perguntas' });
  }
});

// Responder pergunta
router.post('/perguntas/:questionId/responder', async (req, res) => {
  try {
    const { service } = await getMlService(req.user.userId);
    const { text } = req.body;
    const result = await service.answerQuestion(req.params.questionId, text);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao responder pergunta' });
  }
});

module.exports = router;
