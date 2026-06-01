const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const MercadoLivreService = require('../services/mercadolivre');
const { pool } = require('../services/database');

// Redireciona para login do Mercado Livre
router.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const authUrl = MercadoLivreService.getAuthUrl(state);
  res.redirect(authUrl);
});

// Callback OAuth - Mercado Livre redireciona aqui
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  if (error || !code) {
    return res.redirect(`${frontendUrl}/login?error=acesso_negado`);
  }

  try {
    // Troca código por token
    const tokenData = await MercadoLivreService.exchangeCode(code);
    const mlService = new MercadoLivreService(tokenData.access_token);
    const mlUser = await mlService.getMe();

    const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    // Upsert usuário no banco
    const result = await pool.query(`
      INSERT INTO users (ml_user_id, nickname, email, ml_access_token, ml_refresh_token, ml_token_expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (ml_user_id) DO UPDATE SET
        nickname = EXCLUDED.nickname,
        email = EXCLUDED.email,
        ml_access_token = EXCLUDED.ml_access_token,
        ml_refresh_token = EXCLUDED.ml_refresh_token,
        ml_token_expires_at = EXCLUDED.ml_token_expires_at,
        updated_at = NOW()
      RETURNING *
    `, [
      mlUser.id,
      mlUser.nickname,
      mlUser.email,
      tokenData.access_token,
      tokenData.refresh_token,
      tokenExpiresAt
    ]);

    const user = result.rows[0];

    // Gera JWT para o frontend
    const appToken = jwt.sign(
      { userId: user.id, mlUserId: mlUser.id, nickname: mlUser.nickname },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Redireciona para frontend com token
    res.redirect(`${frontendUrl}/dashboard?token=${appToken}&nickname=${encodeURIComponent(mlUser.nickname)}`);

  } catch (err) {
    console.error('Erro no callback OAuth:', err.message);
    res.redirect(`${frontendUrl}/login?error=falha_autenticacao`);
  }
});

// Refresh token ML
router.post('/refresh', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const appToken = authHeader && authHeader.split(' ')[1];

  if (!appToken) return res.status(401).json({ error: 'Não autorizado' });

  try {
    const decoded = jwt.verify(appToken, process.env.JWT_SECRET);
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    const user = userResult.rows[0];

    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    const newTokenData = await MercadoLivreService.refreshToken(user.ml_refresh_token);
    const tokenExpiresAt = new Date(Date.now() + newTokenData.expires_in * 1000);

    await pool.query(`
      UPDATE users SET ml_access_token = $1, ml_refresh_token = $2, ml_token_expires_at = $3
      WHERE id = $4
    `, [newTokenData.access_token, newTokenData.refresh_token, tokenExpiresAt, user.id]);

    res.json({ success: true });
  } catch (err) {
    res.status(401).json({ error: 'Token inválido' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Logout realizado' });
});

// Info do usuário logado
router.get('/me', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Não autorizado' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query(
      'SELECT id, ml_user_id, nickname, email, plan, created_at FROM users WHERE id = $1',
      [decoded.userId]
    );
    res.json(result.rows[0] || null);
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
});

module.exports = router;
