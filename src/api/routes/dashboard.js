// backend/src/routes/dashboard.js
const express = require('express');
const router = express.Router();
const { Sequelize } = require('sequelize');
const authMiddleware = require('../middleware/auth');

// Usar middleware de autenticação
router.use(authMiddleware);

// Configurar Sequelize
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  logging: false,
  dialectOptions: {
    ssl: process.env.NODE_ENV === 'production' ? {
      require: true,
      rejectUnauthorized: false
    } : false
  }
});

// GET /api/dashboard/kpis
router.get('/kpis', async (req, res) => {
  try {
    const empresaId = req.empresaId;
    
    console.log('Buscando KPIs para empresa:', empresaId);
    
    // Buscar leads quentes (score >= 70)
    const [leadsQuentesResult] = await sequelize.query(`
      SELECT COUNT(*) as count 
      FROM "maya-crm".contatos 
      WHERE empresa_id = :empresaId 
      AND ativo = true
      AND score >= 70
    `, {
      replacements: { empresaId }
    });
    
    // Novos leads últimos 7 dias
    const [novosLeadsResult] = await sequelize.query(`
      SELECT COUNT(*) as count 
      FROM "maya-crm".contatos 
      WHERE empresa_id = :empresaId 
      AND criado_em >= NOW() - INTERVAL '7 days'
    `, {
      replacements: { empresaId }
    });
    
    // Visitas agendadas
    const [visitasResult] = await sequelize.query(`
      SELECT COUNT(*) as count 
      FROM "maya-crm".negocios n
      WHERE n.empresa_id = :empresaId
      AND n.ganho IS NULL
      AND n.previsao_fechamento >= CURRENT_DATE
    `, {
      replacements: { empresaId }
    });
    
    // Taxa de conversão
    const [conversaoResult] = await sequelize.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE ganho = true) as ganhos
      FROM "maya-crm".negocios 
      WHERE empresa_id = :empresaId
    `, {
      replacements: { empresaId }
    });
    
    const total = parseInt(conversaoResult[0]?.total) || 0;
    const ganhos = parseInt(conversaoResult[0]?.ganhos) || 0;
    const taxaConversao = total > 0 ? ((ganhos * 100.0) / total) : 0;
    
    // IMPORTANTE: Retornar com os nomes EXATOS que o frontend espera
    const response = {
      leadsQuentes: parseInt(leadsQuentesResult[0]?.count) || 0,
      novosLeads: parseInt(novosLeadsResult[0]?.count) || 0,
      visitasAgendadas: parseInt(visitasResult[0]?.count) || 0,
      taxaConversao: taxaConversao.toFixed(2)
    };
    
    console.log('KPIs retornados:', response);
    res.json(response);
    
  } catch (error) {
    console.error('Erro ao buscar KPIs:', error);
    res.status(500).json({ 
      leadsQuentes: 0,
      novosLeads: 0,
      visitasAgendadas: 0,
      taxaConversao: "0"
    });
  }
});

// GET /api/dashboard/recent-activities
router.get('/recent-activities', async (req, res) => {
  try {
    const empresaId = req.empresaId;
    const activities = [];
    
    // Novos contatos
    const [newContacts] = await sequelize.query(`
      SELECT 
        'new_lead' as type,
        'Novo lead capturado' as title,
        nome || ' - ' || COALESCE(origem, 'Direto') as description,
        criado_em as created_at,
        'UserPlus' as icon,
        'blue' as color
      FROM "maya-crm".contatos
      WHERE empresa_id = :empresaId
      AND criado_em >= NOW() - INTERVAL '7 days'
      ORDER BY criado_em DESC
      LIMIT 3
    `, {
      replacements: { empresaId }
    });
    
    // Últimas mensagens
    const [recentMessages] = await sequelize.query(`
      SELECT DISTINCT ON (c.id)
        'message' as type,
        'Nova mensagem' as title,
        ct.nome || ' respondeu' as description,
        m.criado_em as created_at,
        'MessageCircle' as icon,
        'green' as color
      FROM "maya-crm".mensagens m
      JOIN "maya-crm".conversas c ON m.conversa_id = c.id
      JOIN "maya-crm".contatos ct ON c.contato_id = ct.id
      WHERE c.empresa_id = :empresaId
      AND m.criado_em >= NOW() - INTERVAL '7 days'
      AND m.remetente_tipo = 'contato'
      ORDER BY c.id, m.criado_em DESC
      LIMIT 3
    `, {
      replacements: { empresaId }
    });
    
    // Negócios ganhos
    const [wonDeals] = await sequelize.query(`
      SELECT 
        'deal_won' as type,
        'Negócio fechado' as title,
        ct.nome || ' - R$ ' || TO_CHAR(n.valor, 'FM999G999G999D00') as description,
        n.atualizado_em as created_at,
        'Trophy' as icon,
        'yellow' as color
      FROM "maya-crm".negocios n
      JOIN "maya-crm".contatos ct ON n.contato_id = ct.id
      WHERE n.empresa_id = :empresaId
      AND n.ganho = true
      AND n.atualizado_em >= NOW() - INTERVAL '7 days'
      ORDER BY n.atualizado_em DESC
      LIMIT 2
    `, {
      replacements: { empresaId }
    });
    
    // Combinar e ordenar
    activities.push(...newContacts, ...recentMessages, ...wonDeals);
    activities.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    res.json(activities.slice(0, 8));
    
  } catch (error) {
    console.error('Erro ao buscar atividades:', error);
    res.json([]);
  }
});

// GET /api/dashboard/channel-performance
router.get('/channel-performance', async (req, res) => {
  try {
    const empresaId = req.empresaId;
    
    const [channelData] = await sequelize.query(`
      SELECT 
        c.canal_tipo as channel,
        COUNT(DISTINCT c.id) as messages,
        COUNT(DISTINCT c.contato_id) as contacts,
        COUNT(DISTINCT n.id) FILTER (WHERE n.ganho = true) as conversions
      FROM "maya-crm".conversas c
      LEFT JOIN "maya-crm".negocios n ON c.contato_id = n.contato_id
      WHERE c.empresa_id = :empresaId
      GROUP BY c.canal_tipo
    `, {
      replacements: { empresaId }
    });
    
    res.json(channelData.map(ch => ({
      channel: ch.channel || 'whatsapp',
      messages: parseInt(ch.messages) || 0,
      contacts: parseInt(ch.contacts) || 0,
      conversions: parseInt(ch.conversions) || 0,
      conversionRate: ch.contacts > 0 ? ((ch.conversions * 100) / ch.contacts).toFixed(2) : "0"
    })));
    
  } catch (error) {
    console.error('Erro ao buscar performance por canal:', error);
    res.json([]);
  }
});

// GET /api/dashboard/performance-data
router.get('/performance-data', async (req, res) => {
  try {
    const empresaId = req.empresaId;
    const days = parseInt(req.query.days) || 7;
    
    const [performanceData] = await sequelize.query(`
      WITH date_series AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL :days || ' days',
          CURRENT_DATE,
          '1 day'::interval
        )::date AS date
      )
      SELECT 
        ds.date,
        COUNT(c.id) FILTER (WHERE DATE(c.criado_em) = ds.date) as leads,
        COUNT(m.id) FILTER (WHERE DATE(m.criado_em) = ds.date) as messages,
        COUNT(n.id) FILTER (WHERE DATE(n.criado_em) = ds.date AND n.ganho = true) as conversions
      FROM date_series ds
      LEFT JOIN "maya-crm".contatos c ON DATE(c.criado_em) = ds.date AND c.empresa_id = :empresaId
      LEFT JOIN "maya-crm".mensagens m ON DATE(m.criado_em) = ds.date
      LEFT JOIN "maya-crm".negocios n ON DATE(n.criado_em) = ds.date AND n.empresa_id = :empresaId
      GROUP BY ds.date
      ORDER BY ds.date
    `, {
      replacements: { empresaId, days }
    });
    
    res.json(performanceData.map(row => ({
      date: row.date,
      leads: parseInt(row.leads) || 0,
      messages: parseInt(row.messages) || 0,
      conversions: parseInt(row.conversions) || 0
    })));
    
  } catch (error) {
    console.error('Erro ao buscar dados de performance:', error);
    res.json([]);
  }
});

module.exports = router;