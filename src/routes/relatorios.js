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

// Relatório de produtos mais vendidos
router.get('/mais-vendidos', async (req, res) => {
  try {
    const { service, user } = await getMlService(req.user.userId);
    const { days = 30 } = req.query;
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - parseInt(days));

    const orders = await service.getOrdersByDateRange(
      user.ml_user_id, dateFrom.toISOString(), new Date().toISOString()
    );

    const productMap = {};
    (orders.results || []).forEach(order => {
      (order.order_items || []).forEach(item => {
        const id = item.item?.id;
        const title = item.item?.title || 'Produto';
        if (!id) return;
        if (!productMap[id]) productMap[id] = { id, title, vendas: 0, receita: 0, unidades: 0 };
        productMap[id].vendas++;
        productMap[id].unidades += item.quantity || 0;
        productMap[id].receita += (item.unit_price || 0) * (item.quantity || 0);
      });
    });

    const ranked = Object.values(productMap).sort((a, b) => b.unidades - a.unidades).slice(0, 20);
    res.json({ periodo: `${days} dias`, produtos: ranked });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao gerar relatório' });
  }
});

// Reputação do vendedor
router.get('/reputacao', async (req, res) => {
  try {
    const { service, user } = await getMlService(req.user.userId);
    const rep = await service.getReputation(user.ml_user_id);
    res.json(rep);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar reputação' });
  }
});

module.exports = router;
