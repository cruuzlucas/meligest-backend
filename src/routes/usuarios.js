const express = require('express');
const router = express.Router();
const { pool } = require('../services/database');

router.get('/perfil', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, ml_user_id, nickname, email, plan, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar perfil' });
  }
});

module.exports = router;
