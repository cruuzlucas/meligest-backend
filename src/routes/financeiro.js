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

// Resumo financeiro
router.get('/resumo', async (req, res) => {
  try {
    const { service, user } = await getMlService(req.user.userId);
    const { days = 30 } = req.query;

    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - parseInt(days));

    const orders = await service.getOrdersByDateRange(
      user.ml_user_id,
      dateFrom.toISOString(),
      new Date().toISOString()
    );

    const results = orders.results || [];

    // Busca custos dos produtos
    const costsResult = await pool.query(
      'SELECT item_id, cost_price FROM product_costs WHERE user_id = $1',
      [req.user.userId]
    );
    const costsMap = {};
    costsResult.rows.forEach(c => { costsMap[c.item_id] = parseFloat(c.cost_price); });

    let faturamentoBruto = 0;
    let totalTaxasML = 0;
    let totalCustos = 0;
    let totalUnidades = 0;

    const vendas = results.map(order => {
      const items = order.order_items || [];
      let orderCost = 0;
      let orderUnits = 0;

      items.forEach(item => {
        const qty = item.quantity || 0;
        orderUnits += qty;
        const itemId = item.item?.id;
        if (itemId && costsMap[itemId]) {
          orderCost += costsMap[itemId] * qty;
        }
      });

      const valorBruto = order.total_amount || 0;
      // Taxa ML estimada (aproximadamente 11% para a maioria)
      const taxaML = valorBruto * 0.11;

      faturamentoBruto += valorBruto;
      totalTaxasML += taxaML;
      totalCustos += orderCost;
      totalUnidades += orderUnits;

      return {
        id: order.id,
        data: order.date_created,
        valorBruto,
        taxaML,
        custo: orderCost,
        lucroLiquido: valorBruto - taxaML - orderCost,
        status: order.status,
        comprador: order.buyer?.nickname
      };
    });

    const lucroLiquido = faturamentoBruto - totalTaxasML - totalCustos;
    const margemLiquida = faturamentoBruto > 0 ? (lucroLiquido / faturamentoBruto) * 100 : 0;

    res.json({
      periodo: `${days} dias`,
      faturamentoBruto,
      totalTaxasML,
      totalCustos,
      lucroLiquido,
      margemLiquida,
      totalUnidades,
      totalPedidos: results.length,
      ticketMedio: results.length > 0 ? faturamentoBruto / results.length : 0,
      vendas
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Erro ao calcular financeiro' });
  }
});

module.exports = router;
