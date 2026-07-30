// backend/src/routes/auth.js
// ATUALIZADO: agora o login principal é email/senha. O fluxo do Mercado
// Livre continua existindo, mas com dois papéis possíveis:
//   1) Se o usuário já está logado (manda o JWT), o callback do ML só
//      CONECTA a conta ML à conta MeliGest existente.
//   2) Se ninguém está logado, o callback do ML ainda funciona como
//      "login/cadastro rápido via ML" (comportamento antigo, mantido por
//      compatibilidade e conveniência).

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const MercadoLivreService = require('../services/mercadolivre');
const { supabase } = require('../services/database');
const { validatePassword, validateEmail } = require('../utils/validators');

const SALT_ROUNDS = 12;

// Limite específico e mais rígido para tentativas de login/cadastro
// (além do limiter geral de /api/ já existente no server.js)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' }
});

function signAppToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email_login, isAdmin: !!user.is_admin },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

async function registrarTentativaLogin(email, success, ip) {
  try {
    await supabase.from('login_attempts').insert({ email, success, ip });
  } catch (e) {
    // não deve travar o login por falha no log
    console.error('Falha ao registrar tentativa de login:', e.message);
  }
}

// ---------- Cadastro (email + senha) ----------
router.post('/registrar', authLimiter, async (req, res) => {
  const { email, password, nome } = req.body;

  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'E-mail inválido' });
  }

  const passCheck = validatePassword(password);
  if (!passCheck.valid) {
    return res.status(400).json({ error: passCheck.reason });
  }

  try {
    const { data: existente } = await supabase
      .from('users')
      .select('id')
      .eq('email_login', email.toLowerCase())
      .maybeSingle();

    if (existente) {
      return res.status(409).json({ error: 'Já existe uma conta com esse e-mail' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const { data: user, error } = await supabase
      .from('users')
      .insert({
        email_login: email.toLowerCase(),
        password_hash: passwordHash,
        nickname: nome || email.split('@')[0],
        plan: 'free'
      })
      .select()
      .single();

    if (error) throw error;

    const appToken = signAppToken(user);
    res.status(201).json({ token: appToken, user: { id: user.id, email: user.email_login, plan: user.plan } });
  } catch (err) {
    console.error('Erro no registro:', err.message);
    res.status(500).json({ error: 'Erro ao criar conta' });
  }
});

// ---------- Login (email + senha) ----------
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip;

  if (!validateEmail(email) || typeof password !== 'string') {
    return res.status(400).json({ error: 'E-mail ou senha inválidos' });
  }

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email_login', email.toLowerCase())
      .maybeSingle();

    if (error || !user || !user.password_hash) {
      await registrarTentativaLogin(email, false, ip);
      // Mensagem genérica de propósito: não revelar se o e-mail existe ou não
      return res.status(401).json({ error: 'E-mail ou senha incorretos' });
    }

    const senhaConfere = await bcrypt.compare(password, user.password_hash);

    if (!senhaConfere) {
      await registrarTentativaLogin(email, false, ip);
      return res.status(401).json({ error: 'E-mail ou senha incorretos' });
    }

    await registrarTentativaLogin(email, true, ip);

    const appToken = signAppToken(user);
    res.json({
      token: appToken,
      user: { id: user.id, email: user.email_login, nickname: user.nickname, plan: user.plan, isAdmin: user.is_admin }
    });
  } catch (err) {
    console.error('Erro no login:', err.message);
    res.status(500).json({ error: 'Erro ao processar login' });
  }
});

// ---------- Conectar Mercado Livre ----------
// Gera um "state" assinado que carrega o userId de quem já está logado
// (se estiver). Isso resolve, para o ML também, o mesmo problema de
// callback que documentamos para Shopee/Amazon/Magalu.
router.get('/login', (req, res) => {
  const loggedUserId = req.query.userId || null; // frontend manda se já estiver logado
  const statePayload = { nonce: crypto.randomBytes(8).toString('hex'), userId: loggedUserId };
  const state = jwt.sign(statePayload, process.env.JWT_SECRET, { expiresIn: '10m' });

  const authUrl = MercadoLivreService.getAuthUrl(state);
  res.redirect(authUrl);
});

router.get('/callback', async (req, res) => {
  const { code, error, state } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  if (error || !code) {
    return res.redirect(`${frontendUrl}/login?error=acesso_negado`);
  }

  let existingUserId = null;
  try {
    if (state) {
      const decodedState = jwt.verify(state, process.env.JWT_SECRET);
      existingUserId = decodedState.userId || null;
    }
  } catch (e) {
    // state inválido/expirado: segue como se não houvesse usuário logado
  }

  try {
    const tokenData = await MercadoLivreService.exchangeCode(code);
    const mlService = new MercadoLivreService(tokenData.access_token);
    const mlUser = await mlService.getMe();
    const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    let user;

    if (existingUserId) {
      // Usuário já logado (email/senha) conectando o ML à conta dele
      const { data, error: updateError } = await supabase
        .from('users')
        .update({
          ml_user_id: String(mlUser.id),
          ml_access_token: tokenData.access_token,
          ml_refresh_token: tokenData.refresh_token,
          ml_token_expires_at: tokenExpiresAt,
          updated_at: new Date()
        })
        .eq('id', existingUserId)
        .select()
        .single();

      if (updateError) throw updateError;
      user = data;
    } else {
      // Ninguém logado: mantém o comportamento antigo (login/cadastro via ML)
      const { data, error: upsertError } = await supabase
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

      if (upsertError) throw upsertError;
      user = data;
    }

    const appToken = signAppToken(user);
    res.redirect(`${frontendUrl}/dashboard?token=${appToken}&nickname=${encodeURIComponent(mlUser.nickname)}`);
  } catch (err) {
    console.error('Erro no callback OAuth:', err.message);
    res.redirect(`${frontendUrl}/login?error=falha_autenticacao`);
  }
});

// ---------- Refresh token ML ----------
router.post('/refresh', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const appToken = authHeader && authHeader.split(' ')[1];
  if (!appToken) return res.status(401).json({ error: 'Não autorizado' });

  try {
    const decoded = jwt.verify(appToken, process.env.JWT_SECRET);
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (!user.ml_refresh_token) return res.status(400).json({ error: 'Nenhuma conta ML conectada' });

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

router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Logout realizado' });
});

router.get('/me', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Não autorizado' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { data, error } = await supabase
      .from('users')
      .select('id, email_login, nickname, email, plan, is_admin, ml_user_id, created_at')
      .eq('id', decoded.userId)
      .single();

    if (error) return res.json(null);
    res.json(data);
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
});

module.exports = router;
