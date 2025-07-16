// backend/src/routes/dashboard.js
const express = require('express');
const router = express.Router();
const { Sequelize } = require('sequelize');

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
    // Buscar KPIs reais do banco
    const [[kpis]] = await sequelize.query(`
      SELECT 
        -- Contatos/Leads
        (SELECT COUNT(*) FROM "maya-crm".contatos WHERE ativo = true) as total_leads,
        (SELECT COUNT(*) FROM "maya-crm".contatos WHERE DATE(criado_em) = CURRENT_DATE) as novos_leads_hoje,
        
        -- Tarefas/Visitas
        (SELECT COUNT(*) FROM "maya-crm".tarefas 
         WHERE status = 'pendente' 
         AND tipo = 'visita'
         AND DATE(data_vencimento) >= CURRENT_DATE) as visitas_agendadas,
        
        -- Taxa de conversão (negócios ganhos / total de negócios * 100)
        COALESCE(
          (SELECT COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM "maya-crm".negocios), 0)
           FROM "maya-crm".negocios WHERE ganho = true), 
          0
        )::numeric(5,2) as taxa_conversao,
        
        -- Vendas totais
        COALESCE((SELECT SUM(valor) FROM "maya-crm".negocios WHERE ganho = true), 0) as vendas_total,
        
        -- Meta atingida (exemplo: vendas/meta * 100)
        -- Como não temos tabela de metas, vamos simular com base em um valor fixo
        CASE 
          WHEN COALESCE((SELECT SUM(valor) FROM "maya-crm".negocios WHERE ganho = true), 0) > 0
          THEN LEAST(((SELECT SUM(valor) FROM "maya-crm".negocios WHERE ganho = true) / 3000000.0 * 100), 100)::numeric(5,2)
          ELSE 0
        END as meta_atingida,
        
        -- Novos clientes (contatos com negócios ganhos este mês)
        (SELECT COUNT(DISTINCT c.id) 
         FROM "maya-crm".contatos c
         JOIN "maya-crm".negocios n ON n.contato_id = c.id
         WHERE n.ganho = true 
         AND DATE_TRUNC('month', n.fechado_em) = DATE_TRUNC('month', CURRENT_DATE)) as novos_clientes,
        
        -- Ticket médio
        COALESCE(
          (SELECT AVG(valor) FROM "maya-crm".negocios WHERE ganho = true), 
          0
        )::numeric(12,2) as ticket_medio
    `);
    
    // Formatar resposta
    const response = {
      totalLeads: parseInt(kpis.total_leads) || 0,
      newLeadsToday: parseInt(kpis.novos_leads_hoje) || 0,
      scheduledVisits: parseInt(kpis.visitas_agendadas) || 0,
      conversionRate: parseFloat(kpis.taxa_conversao) || 0,
      totalSales: parseFloat(kpis.vendas_total) || 0,
      targetAchieved: parseFloat(kpis.meta_atingida) || 0,
      newCustomers: parseInt(kpis.novos_clientes) || 0,
      averageTicket: parseFloat(kpis.ticket_medio) || 0
    };
    
    res.json(response);
  } catch (error) {
    console.error('Erro ao buscar KPIs:', error);
    res.status(500).json({ error: 'Erro ao buscar KPIs' });
  }
});

// GET /api/dashboard/recent-activities
router.get('/recent-activities', async (req, res) => {
  try {
    // Buscar atividades recentes reais
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
      WHERE criado_em >= NOW() - INTERVAL '24 hours'
      ORDER BY criado_em DESC
      LIMIT 3
    `);
    
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
      WHERE m.criado_em >= NOW() - INTERVAL '24 hours'
      AND m.remetente_tipo = 'contato'
      ORDER BY c.id, m.criado_em DESC
      LIMIT 3
    `);
    
    // 3. Tarefas agendadas
    const [scheduledTasks] = await sequelize.query(`
      SELECT 
        'visit_scheduled' as type,
        'Visita agendada' as title,
        t.titulo || ' - ' || TO_CHAR(t.data_vencimento, 'DD/MM às HH24h') as description,
        t.criado_em as created_at,
        'Calendar' as icon,
        'purple' as color
      FROM "maya-crm".tarefas t
      WHERE t.tipo = 'visita'
      AND t.status = 'pendente'
      AND t.criado_em >= NOW() - INTERVAL '24 hours'
      ORDER BY t.criado_em DESC
      LIMIT 3
    `);
    
    // 4. Negócios ganhos
    const [wonDeals] = await sequelize.query(`
      SELECT 
        'deal_won' as type,
        'Negócio fechado!' as title,
        c.nome || ' - ' || n.titulo || ' por R$ ' || TO_CHAR(n.valor, 'FM999G999G999D00') as description,
        n.fechado_em as created_at,
        'TrendingUp' as icon,
        'green' as color
      FROM "maya-crm".negocios n
      JOIN "maya-crm".contatos c ON n.contato_id = c.id
      WHERE n.ganho = true
      AND n.fechado_em >= NOW() - INTERVAL '7 days'
      ORDER BY n.fechado_em DESC
      LIMIT 2
    `);
    
    // Combinar e ordenar todas as atividades
    const allActivities = [...newContacts, ...recentMessages, ...scheduledTasks, ...wonDeals]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10)
      .map((activity, index) => ({
        id: index + 1,
        ...activity,
        time: getRelativeTime(activity.created_at)
      }));
    
    res.json(allActivities);
  } catch (error) {
    console.error('Erro ao buscar atividades:', error);
    res.status(500).json({ error: 'Erro ao buscar atividades' });
  }
});

// GET /api/dashboard/performance-data
router.get('/performance-data', async (req, res) => {
  try {
    // Buscar dados de performance dos últimos 10 dias
    const [performanceData] = await sequelize.query(`
      WITH date_series AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '9 days',
          CURRENT_DATE,
          INTERVAL '1 day'
        )::date AS data
      )
      SELECT 
        TO_CHAR(ds.data, 'DD/MM') as day,
        COALESCE(COUNT(DISTINCT c.id), 0) as leads,
        COALESCE(COUNT(DISTINCT n.id) FILTER (WHERE n.ganho = true), 0) as conversions
      FROM date_series ds
      LEFT JOIN "maya-crm".contatos c ON DATE(c.criado_em) = ds.data
      LEFT JOIN "maya-crm".negocios n ON DATE(n.fechado_em) = ds.data
      GROUP BY ds.data
      ORDER BY ds.data
    `);
    
    res.json(performanceData);
  } catch (error) {
    console.error('Erro ao buscar dados de performance:', error);
    res.status(500).json({ error: 'Erro ao buscar dados de performance' });
  }
});

// GET /api/dashboard/channel-performance
router.get('/channel-performance', async (req, res) => {
  try {
    // Performance real por canal
    const [channelData] = await sequelize.query(`
      SELECT 
        CASE 
          WHEN canal_tipo = 'whatsapp' THEN 'WhatsApp'
          WHEN canal_tipo = 'instagram' THEN 'Instagram'
          WHEN canal_tipo = 'facebook' THEN 'Facebook'
          WHEN canal_tipo = 'email' THEN 'Email'
          ELSE 'Outros'
        END as name,
        COUNT(*) as value,
        CASE 
          WHEN canal_tipo = 'whatsapp' THEN '#25D366'
          WHEN canal_tipo = 'instagram' THEN '#E4405F'
          WHEN canal_tipo = 'facebook' THEN '#1877F2'
          WHEN canal_tipo = 'email' THEN '#EA4335'
          ELSE '#6366F1'
        END as fill
      FROM "maya-crm".conversas
      GROUP BY canal_tipo
      ORDER BY COUNT(*) DESC
    `);
    
    res.json(channelData);
  } catch (error) {
    console.error('Erro ao buscar performance por canal:', error);
    res.status(500).json({ error: 'Erro ao buscar performance por canal' });
  }
});

// GET /api/dashboard/sales-funnel
router.get('/sales-funnel', async (req, res) => {
  try {
    // Buscar dados reais do funil
    const [funnelData] = await sequelize.query(`
      WITH pipeline_stats AS (
        SELECT 
          pe.id,
          pe.nome,
          pe.ordem,
          COUNT(n.id) as quantidade,
          COALESCE(SUM(n.valor), 0) as valor_total
        FROM "maya-crm".pipeline_etapas pe
        LEFT JOIN "maya-crm".negocios n ON n.etapa_id = pe.id
        WHERE pe.ativo = true
        GROUP BY pe.id, pe.nome, pe.ordem
        ORDER BY pe.ordem
      )
      SELECT 
        nome as stage,
        quantidade as value,
        CASE 
          WHEN (SELECT MAX(quantidade) FROM pipeline_stats) > 0
          THEN (quantidade * 100.0 / (SELECT MAX(quantidade) FROM pipeline_stats))::numeric(5,2)
          ELSE 0
        END as percentage,
        valor_total
      FROM pipeline_stats
    `);
    
    res.json(funnelData);
  } catch (error) {
    console.error('Erro ao buscar funil de vendas:', error);
    res.status(500).json({ error: 'Erro ao buscar funil de vendas' });
  }
});

// GET /api/dashboard/top-sellers
router.get('/top-sellers', async (req, res) => {
  try {
    // Top vendedores reais
    const [sellers] = await sequelize.query(`
      SELECT 
        u.nome as name,
        COUNT(n.id) as sales,
        COALESCE(SUM(n.valor), 0)::numeric(12,2) as revenue,
        u.avatar_url as avatar
      FROM "maya-crm".usuarios u
      LEFT JOIN "maya-crm".negocios n ON n.responsavel_id = u.id AND n.ganho = true
      WHERE u.ativo = true
      GROUP BY u.id, u.nome, u.avatar_url
      HAVING COUNT(n.id) > 0
      ORDER BY SUM(n.valor) DESC NULLS LAST
      LIMIT 5
    `);
    
    res.json(sellers);
  } catch (error) {
    console.error('Erro ao buscar top vendedores:', error);
    res.status(500).json({ error: 'Erro ao buscar top vendedores' });
  }
});

// GET /api/dashboard/metrics-summary
router.get('/metrics-summary', async (req, res) => {
  try {
    // Métricas de conversação e mensagens
    const [[metrics]] = await sequelize.query(`
      SELECT 
        -- Conversas
        (SELECT COUNT(*) FROM "maya-crm".conversas WHERE status = 'aberta') as conversas_abertas,
        (SELECT COUNT(*) FROM "maya-crm".conversas WHERE DATE(criado_em) = CURRENT_DATE) as conversas_hoje,
        
        -- Mensagens
        (SELECT COUNT(*) FROM "maya-crm".mensagens WHERE DATE(criado_em) = CURRENT_DATE) as mensagens_hoje,
        
        -- Tempo médio de resposta (em minutos)
        (SELECT AVG(tempo_primeira_resposta) / 60 FROM "maya-crm".conversas 
         WHERE tempo_primeira_resposta IS NOT NULL)::numeric(5,2) as tempo_medio_resposta,
        
        -- Negócios em andamento
        (SELECT COUNT(*) FROM "maya-crm".negocios 
         WHERE ganho IS NULL AND fechado_em IS NULL) as negocios_abertos,
         
        -- Valor total em negociação
        COALESCE((SELECT SUM(valor) FROM "maya-crm".negocios 
         WHERE ganho IS NULL AND fechado_em IS NULL), 0)::numeric(12,2) as valor_em_negociacao
    `);
    
    res.json(metrics);
  } catch (error) {
    console.error('Erro ao buscar métricas:', error);
    res.status(500).json({ error: 'Erro ao buscar métricas' });
  }
});

// Função auxiliar para tempo relativo
function getRelativeTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Agora mesmo';
  if (diffMins < 60) return `${diffMins} minuto${diffMins > 1 ? 's' : ''} atrás`;
  if (diffHours < 24) return `${diffHours} hora${diffHours > 1 ? 's' : ''} atrás`;
  if (diffDays < 7) return `${diffDays} dia${diffDays > 1 ? 's' : ''} atrás`;
  
  return date.toLocaleDateString('pt-BR');
}

module.exports = router;
