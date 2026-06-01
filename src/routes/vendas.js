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

// Lista vendas recentes
router.get('/', async (req, res) => {
  try {
    const { service, user } = await getMlService(req.user.userId);
    const { offset = 0, limit = 50, dateFrom, dateTo } = req.query;

    let orders;
    if (dateFrom && dateTo) {
      orders = await service.getOrdersByDateRange(user.ml_user_id, dateFrom, dateTo, parseInt(offset));
    } else {
      orders = await service.getOrders(user.ml_user_id, { offset: parseInt(offset), limit: parseInt(limit) });
    }

    res.json(orders);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Erro ao buscar vendas' });
  }
});

// Detalhe de uma venda
router.get('/:orderId', async (req, res) => {
  try {
    const { service } = await getMlService(req.user.userId);
    const order = await service.getOrderById(req.params.orderId);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar venda' });
  }
});

// Resumo / estatísticas de vendas
router.get('/stats/summary', async (req, res) => {
  try {
    const { service, user } = await getMlService(req.user.userId);

    // Últimos 30 dias
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 30);
    const dateTo = new Date();

    const orders = await service.getOrdersByDateRange(
      user.ml_user_id,
      dateFrom.toISOString(),
      dateTo.toISOString()
    );

    const results = orders.results || [];

    const totalVendas = results.length;
    const totalFaturamento = results.reduce((acc, o) => acc + (o.total_amount || 0), 0);
    const totalUnidades = results.reduce((acc, o) => {
      return acc + (o.order_items || []).reduce((s, i) => s + (i.quantity || 0), 0);
    }, 0);

    // Vendas por dia (últimos 7 dias)
    const vendasPorDia = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      vendasPorDia[key] = { data: key, vendas: 0, faturamento: 0 };
    }

    results.forEach(o => {
      const day = (o.date_created || '').split('T')[0];
      if (vendasPorDia[day]) {
        vendasPorDia[day].vendas++;
        vendasPorDia[day].faturamento += o.total_amount || 0;
      }
    });

    res.json({
      periodo: '30 dias',
      totalVendas,
      totalFaturamento,
      totalUnidades,
      ticketMedio: totalVendas > 0 ? totalFaturamento / totalVendas : 0,
      vendasPorDia: Object.values(vendasPorDia)
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Erro ao calcular estatísticas' });
  }
});

module.exports = router;
