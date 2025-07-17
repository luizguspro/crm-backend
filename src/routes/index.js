// backend/src/routes/index.js
const express = require('express');
const router = express.Router();

// Importar rotas
const authRoutes = require('./auth');
const dashboardRoutes = require('./dashboard');
const contactsRoutes = require('./contacts');
const pipelineRoutes = require('./pipeline'); // ADICIONAR ESTA LINHA

// Usar rotas
router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/contacts', contactsRoutes);
router.use('/pipeline', pipelineRoutes); // ADICIONAR ESTA LINHA

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
        'GET /contacts/:id': 'Detalhes do contato',
        'POST /contacts': 'Criar contato',
        'PUT /contacts/:id': 'Atualizar contato',
        'DELETE /contacts/:id': 'Excluir contato'
      },
      pipeline: {
        'GET /pipeline/stages': 'Listar etapas do pipeline',
        'GET /pipeline/deals': 'Listar negócios',
        'POST /pipeline/deals': 'Criar negócio',
        'PUT /pipeline/deals/:id': 'Atualizar negócio',
        'PUT /pipeline/deals/:id/move': 'Mover negócio entre etapas',
        'DELETE /pipeline/deals/:id': 'Excluir negócio'
      }
    }
  });
});

module.exports = router;