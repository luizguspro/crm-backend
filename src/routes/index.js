// backend/src/routes/index.js
const express = require('express');
const router = express.Router();

// Importar rotas
const authRoutes = require('./auth');
const dashboardRoutes = require('./dashboard');
const contactsRoutes = require('./contacts');

// Usar rotas
router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/contacts', contactsRoutes);

// Rota de teste da API
router.get('/', (req, res) => {
  res.json({ 
    message: 'Maya CRM API v1',
    endpoints: {
      auth: {
        'POST /auth/login': 'Login de usuário',
        'POST /auth/register': 'Registro de usuário',
        'POST /auth/logout': 'Logout',
        'GET /auth/verify': 'Verificar token',
        'GET /auth/me': 'Dados do usuário atual'
      },
      dashboard: {
        'GET /dashboard/kpis': 'KPIs principais',
        'GET /dashboard/recent-activities': 'Atividades recentes',
        'GET /dashboard/performance-data': 'Dados de performance',
        'GET /dashboard/channel-performance': 'Performance por canal',
        'GET /dashboard/sales-funnel': 'Funil de vendas',
        'GET /dashboard/top-sellers': 'Top vendedores',
        'GET /dashboard/metrics-summary': 'Resumo de métricas'
      },
      contacts: {
        'GET /contacts': 'Listar contatos',
        'GET /contacts/:id': 'Detalhes do contato'
      }
    }
  });
});

// TODO: Adicionar outras rotas
// router.use('/messages', require('./messages'));
// router.use('/pipeline', require('./pipeline'));
// router.use('/tasks', require('./tasks'));

module.exports = router;
