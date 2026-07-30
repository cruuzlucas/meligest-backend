require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const vendaRoutes = require('./routes/vendas');
const anuncioRoutes = require('./routes/anuncios');
const financeiroRoutes = require('./routes/financeiro');
const relatorioRoutes = require('./routes/relatorios');
const usuarioRoutes = require('./routes/usuarios');
const { authenticateToken } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3001;

// Segurança
app.use(helmet());
app.use(morgan('combined'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' }
});
app.use('/api/', limiter);

// CORS
app.use(cors({
  origin: [process.env.FRONTEND_URL || 'http://localhost:3000'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rotas públicas
app.use('/auth', authRoutes);

// Rotas protegidas
app.use('/api/vendas', authenticateToken, vendaRoutes);
app.use('/api/anuncios', authenticateToken, anuncioRoutes);
app.use('/api/financeiro', authenticateToken, financeiroRoutes);
app.use('/api/relatorios', authenticateToken, relatorioRoutes);
app.use('/api/usuarios', authenticateToken, usuarioRoutes);
// TEMP - diagnóstico de banco (remover depois)
app.get('/debug-db', async (req, res) => {
  const raw = process.env.DATABASE_URL || '';
  let parsed = null;
  try {
    const u = new URL(raw);
    parsed = {
      protocol: u.protocol,
      user: u.username,
      passwordLength: u.password ? u.password.length : 0,
      host: u.hostname,
      port: u.port,
      database: u.pathname
    };
  } catch (e) {
    parsed = { parseError: e.message };
  }

  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: raw,
    ssl: { rejectUnauthorized: false }
  });
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ ok: true, time: result.rows[0], rawLength: raw.length, parsed });
  } catch (err) {
    res.json({ ok: false, error: err.message, code: err.code, rawLength: raw.length, parsed });
  } finally {
    await pool.end();
  }
});
// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Erro global
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

module.exports = app;
