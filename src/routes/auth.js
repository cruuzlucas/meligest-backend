const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const MercadoLivreService = require('../services/mercadolivre');
const { supabase } = require('../services/database');

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

    // Upsert usuário no banco via Supabase REST API
    const { data: user, error: dbError } = await supabase
      .from('users')
      .upsert({
        ml_user_id: String(mlUser.id),
        nickname: mlUser.nickname,
        email: mlUser.email,
        ml_access_token: tokenData.access_token,
        ml_refresh_token: tokenData.refresh_token,
        ml_token_expires_at: tokenExpiresAt,
        updated_at: new Date()
      }, { onConflict: 'ml_user_id' })
      .select()
      .single();

    if (dbError) throw dbError;

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

    const { data: user, error: findError } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.userId)
      .single();

    if (findError || !user) return res.status(404).json({ error: 'Usuário não encontrado' });

    const newTokenData = await MercadoLivreService.refreshToken(user.ml_refresh_token);
    const tokenExpiresAt = new Date(Date.now() + newTokenData.expires_in * 1000);

    const { error: updateError } = await supabase
      .from('users')
      .update({
        ml_access_token: newTokenData.access_token,
        ml_refresh_token: newTokenData.refresh_token,
        ml_token_expires_at: tokenExpiresAt
      })
      .eq('id', user.id);

    if (updateError) throw updateError;

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
    const { data, error } = await supabase
      .from('users')
      .select('id, ml_user_id, nickname, email, plan, created_at')
      .eq('id', decoded.userId)
      .single();

    if (error) return res.json(null);
    res.json(data);
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
});

module.exports = router;
