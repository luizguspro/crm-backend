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
    
    // Log para debug
    console.log('Buscando KPIs para empresa:', empresaId);
    
    // Buscar contatos ativos (leads quentes com score >= 70)
    const [totalLeadsResult] = await sequelize.query(`
      SELECT COUNT(*) as count 
      FROM "maya-crm".contatos 
      WHERE empresa_id = :empresaId 
      AND ativo = true
      AND score >= 70
    `, {
      replacements: { empresaId }
    });
    
    // Log para debug
    console.log('Leads quentes (score >= 70):', totalLeadsResult[0]?.count);
    
    // Novos leads hoje
    const [novosHojeResult] = await sequelize.query(`
      SELECT COUNT(*) as count 
      FROM "maya-crm".contatos 
      WHERE empresa_id = :empresaId 
      AND DATE(criado_em) = CURRENT_DATE
    `, {
      replacements: { empresaId }
    });
    
    // Visitas agendadas (simulado baseado em negócios com data futura)
    const [visitasResult] = await sequelize.query(`
      SELECT COUNT(*) as count 
      FROM "maya-crm".tarefas 
      WHERE empresa_id = :empresaId
      AND status = 'pendente' 
      AND data_vencimento >= CURRENT_TIMESTAMP
    `, {
      replacements: { empresaId }
    });
    
    // Se não tiver tarefas, contar negócios em negociação como visitas potenciais
    let visitasAgendadas = parseInt(visitasResult[0]?.count) || 0;
    if (visitasAgendadas === 0) {
      const [negociosEmAndamento] = await sequelize.query(`
        SELECT COUNT(*) as count 
        FROM "maya-crm".negocios n
        JOIN "maya-crm".pipeline_etapas pe ON n.etapa_id = pe.id
        WHERE n.empresa_id = :empresaId
        AND n.ganho IS NULL
        AND pe.ordem >= 3
      `, {
        replacements: { empresaId }
      });
      visitasAgendadas = parseInt(negociosEmAndamento[0]?.count) || 0;
    }
    
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
    const taxaConversao = total > 0 ? (ganhos * 100.0 / total) : 0;
    
    // Vendas totais e outros KPIs
    const [vendasResult] = await sequelize.query(`
      SELECT 
        COALESCE(SUM(valor), 0) as vendas_total,
        COALESCE(AVG(valor), 0) as ticket_medio,
        COUNT(DISTINCT contato_id) as clientes_ganhos
      FROM "maya-crm".negocios 
      WHERE empresa_id = :empresaId 
      AND ganho = true
    `, {
      replacements: { empresaId }
    });
    
    // Montar resposta
    const response = {
      totalLeads: parseInt(totalLeadsResult[0]?.count) || 0,
      newLeadsToday: parseInt(novosHojeResult[0]?.count) || 0,
      scheduledVisits: visitasAgendadas,
      conversionRate: taxaConversao.toFixed(2),
      totalSales: parseFloat(vendasResult[0]?.vendas_total) || 0,
      targetAchieved: 0, // Pode ser calculado com base em meta
      newCustomers: parseInt(vendasResult[0]?.clientes_ganhos) || 0,
      averageTicket: parseFloat(vendasResult[0]?.ticket_medio) || 0
    };
    
    console.log('KPIs calculados:', response);
    res.json(response);
    
  } catch (error) {
    console.error('Erro ao buscar KPIs:', error);
    res.status(500).json({ error: 'Erro ao buscar KPIs' });
  }
});

// GET /api/dashboard/recent-activities
router.get('/recent-activities', async (req, res) => {
  try {
    const empresaId = req.empresaId;
    const activities = [];
    
    // 1. Novos contatos
    const [newContacts] = await sequelize.query(`
      SELECT 
        'new_lead' as type,
        'Novo lead capturado' as title,
        nome || ' - ' || COALESCE(origem, 'Origem não especificada') as description,
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
    
    // 2. Últimas mensagens
    const [recentMessages] = await sequelize.query(`
      SELECT DISTINCT ON (c.id)
        'message' as type,
        'Nova mensagem' as title,
        ct.nome || ' respondeu no ' || c.canal_tipo as description,
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
    
    // 3. Negócios movidos
    const [movedDeals] = await sequelize.query(`
      SELECT 
        'deal_moved' as type,
        'Negócio movido' as title,
        n.titulo || ' - ' || pe.nome as description,
        n.atualizado_em as created_at,
        'Target' as icon,
        'purple' as color
      FROM "maya-crm".negocios n
      JOIN "maya-crm".pipeline_etapas pe ON n.etapa_id = pe.id
      WHERE n.empresa_id = :empresaId
      AND n.atualizado_em >= NOW() - INTERVAL '7 days'
      AND n.ganho IS NULL
      ORDER BY n.atualizado_em DESC
      LIMIT 3
    `, {
      replacements: { empresaId }
    });
    
    // 4. Negócios ganhos
    const [wonDeals] = await sequelize.query(`
      SELECT 
        'deal_won' as type,
        'Negócio fechado!' as title,
        n.titulo || ' - R$ ' || TO_CHAR(n.valor, 'FM999G999G999D00') as description,
        n.fechado_em as created_at,
        'Trophy' as icon,
        'yellow' as color
      FROM "maya-crm".negocios n
      WHERE n.empresa_id = :empresaId
      AND n.ganho = true
      AND n.fechado_em >= NOW() - INTERVAL '7 days'
      ORDER BY n.fechado_em DESC
      LIMIT 2
    `, {
      replacements: { empresaId }
    });
    
    // Combinar todas as atividades
    activities.push(...newContacts, ...recentMessages, ...movedDeals, ...wonDeals);
    
    // Ordenar por data e formatar
    const sortedActivities = activities
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10)
      .map(activity => ({
        ...activity,
        time: formatRelativeTime(activity.created_at)
      }));
    
    res.json(sortedActivities);
  } catch (error) {
    console.error('Erro ao buscar atividades recentes:', error);
    res.status(500).json({ error: 'Erro ao buscar atividades' });
  }
});

// GET /api/dashboard/performance-data
router.get('/performance-data', async (req, res) => {
  try {
    const empresaId = req.empresaId;
    
    // Dados dos últimos 7 dias
    const [performanceData] = await sequelize.query(`
      WITH date_series AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '6 days',
          CURRENT_DATE,
          '1 day'::interval
        )::date AS data
      )
      SELECT 
        TO_CHAR(ds.data, 'DD/MM') as date,
        COALESCE(COUNT(DISTINCT c.id), 0) as leads,
        COALESCE(COUNT(DISTINCT n.id), 0) as vendas
      FROM date_series ds
      LEFT JOIN "maya-crm".contatos c ON DATE(c.criado_em) = ds.data 
        AND c.empresa_id = :empresaId
      LEFT JOIN "maya-crm".negocios n ON DATE(n.fechado_em) = ds.data 
        AND n.ganho = true 
        AND n.empresa_id = :empresaId
      GROUP BY ds.data
      ORDER BY ds.data
    `, {
      replacements: { empresaId }
    });
    
    res.json(performanceData);
  } catch (error) {
    console.error('Erro ao buscar dados de performance:', error);
    res.status(500).json({ error: 'Erro ao buscar dados de performance' });
  }
});

// GET /api/dashboard/channel-performance
router.get('/channel-performance', async (req, res) => {
  try {
    const empresaId = req.empresaId;
    
    // Performance por canal
    const [channelData] = await sequelize.query(`
      SELECT 
        CASE 
          WHEN origem = 'whatsapp' THEN 'WhatsApp'
          WHEN origem = 'instagram' THEN 'Instagram'
          WHEN origem = 'facebook' THEN 'Facebook'
          WHEN origem = 'website' THEN 'Website'
          WHEN origem = 'email' THEN 'Email'
          ELSE 'Outros'
        END as name,
        COUNT(*) as value,
        CASE 
          WHEN origem = 'whatsapp' THEN '#25D366'
          WHEN origem = 'instagram' THEN '#E4405F'
          WHEN origem = 'facebook' THEN '#1877F2'
          WHEN origem = 'website' THEN '#0088CC'
          WHEN origem = 'email' THEN '#EA4335'
          ELSE '#6366F1'
        END as fill
      FROM "maya-crm".contatos
      WHERE empresa_id = :empresaId
      AND origem IS NOT NULL
      GROUP BY origem
      ORDER BY COUNT(*) DESC
    `, {
      replacements: { empresaId }
    });
    
    res.json(channelData);
  } catch (error) {
    console.error('Erro ao buscar performance por canal:', error);
    res.status(500).json({ error: 'Erro ao buscar performance por canal' });
  }
});

// Função auxiliar para formatar tempo relativo
function formatRelativeTime(date) {
  const now = new Date();
  const past = new Date(date);
  const diffMs = now - past;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) {
    return 'Agora';
  } else if (diffMins < 60) {
    return `${diffMins} min atrás`;
  } else if (diffHours < 24) {
    return `${diffHours}h atrás`;
  } else if (diffDays < 7) {
    return `${diffDays}d atrás`;
  } else {
    return past.toLocaleDateString('pt-BR');
  }
}

module.exports = router;