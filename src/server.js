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
const planoRoutes = require('./routes/planos');
const adminRoutes = require('./routes/admin');
const pagamentoRoutes = require('./routes/pagamentos');
const plataformaRoutes = require('./routes/plataformas');
const lucratividadeRoutes = require('./routes/lucratividade');
const copilotoRoutes = require('./routes/copiloto');

const { authenticateToken } = require('./middleware/auth');
const { requireAdmin } = require('./middleware/permissions');

const app = express();
const PORT = process.env.PORT || 3001;

// Segurança
app.use(helmet());
app.use(morgan('combined'));

// Rate limiting geral
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
app.use('/plataformas', authenticateToken, plataformaRoutes);
app.use('/pagamentos', pagamentoRoutes); // SEM authenticateToken: quem chama é o Mercado Pago

// Rotas protegidas (login obrigatório)
app.use('/api/vendas', authenticateToken, vendaRoutes);
app.use('/api/anuncios', authenticateToken, anuncioRoutes);
app.use('/api/financeiro', authenticateToken, financeiroRoutes);
app.use('/api/relatorios', authenticateToken, relatorioRoutes);
app.use('/api/usuarios', authenticateToken, usuarioRoutes);
app.use('/api/planos', authenticateToken, planoRoutes);
app.use('/lucratividade', authenticateToken, lucratividadeRoutes);
app.use('/copiloto', authenticateToken, copilotoRoutes);

// Rotas de admin (login + ser admin)
app.use('/api/admin', authenticateToken, requireAdmin, adminRoutes);

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
