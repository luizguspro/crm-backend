// backend/src/api/routes/dashboard.js
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize } = require('../../database');
const { 
  Contato, 
  Conversa, 
  Mensagem, 
  Negocio, 
  PipelineEtapa 
} = require('../../models');

// Middleware temporário para empresa padrão
const setDefaultEmpresa = (req, res, next) => {
  req.empresaId = process.env.DEFAULT_EMPRESA_ID || '00000000-0000-0000-0000-000000000001';
  next();
};

router.use(setDefaultEmpresa);

// GET /api/dashboard/kpis
router.get('/kpis', async (req, res) => {
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    
    const semanaPassada = new Date();
    semanaPassada.setDate(semanaPassada.getDate() - 7);
    
    // Buscar dados REAIS do banco
    const leadsQuentes = await Contato.count({
      where: {
        empresa_id: req.empresaId,
        score: { [Op.gte]: 70 },
        ativo: true
      }
    });

    const novosLeads = await Contato.count({
      where: {
        empresa_id: req.empresaId,
        criado_em: { [Op.gte]: semanaPassada }
      }
    });

    const visitasAgendadas = await Negocio.count({
      where: {
        empresa_id: req.empresaId,
        previsao_fechamento: { [Op.gte]: hoje },
        ganho: null
      }
    });

    const totalLeads = await Contato.count({
      where: { empresa_id: req.empresaId }
    });
    
    const negociosGanhos = await Negocio.count({
      where: {
        empresa_id: req.empresaId,
        ganho: true
      }
    });

    const taxaConversao = totalLeads > 0 
      ? Math.round((negociosGanhos / totalLeads) * 100) 
      : 0;

    res.json({
      leadsQuentes,
      novosLeads,
      visitasAgendadas,
      taxaConversao
    });

  } catch (error) {
    console.error('Erro ao buscar KPIs:', error);
    res.json({
      leadsQuentes: 0,
      novosLeads: 0,
      visitasAgendadas: 0,
      taxaConversao: 0
    });
  }
});

// GET /api/dashboard/recent-activities
router.get('/recent-activities', async (req, res) => {
  try {
    // Buscar últimas mensagens REAIS
    const ultimasMensagens = await Mensagem.findAll({
      include: [{
        model: Conversa,
        where: { empresa_id: req.empresaId },
        include: [{
          model: Contato,
          attributes: ['nome', 'whatsapp']
        }]
      }],
      where: {
        remetente_tipo: 'contato'
      },
      order: [['criado_em', 'DESC']],
      limit: 10
    });

    // Buscar últimos negócios REAIS
    const ultimosNegocios = await Negocio.findAll({
      where: { empresa_id: req.empresaId },
      include: [{
        model: Contato,
        attributes: ['nome']
      }],
      order: [['criado_em', 'DESC']],
      limit: 5
    });

    // Formatar atividades
    const activities = [];

    // Adicionar mensagens reais
    ultimasMensagens.forEach(msg => {
      if (msg.Conversa && msg.Conversa.Contato) {
        activities.push({
          id: msg.id,
          type: 'message',
          text: `Nova mensagem de ${msg.Conversa.Contato.nome}`,
          time: msg.criado_em,
          contactName: msg.Conversa.Contato.nome
        });
      }
    });

    // Adicionar negócios reais
    ultimosNegocios.forEach(deal => {
      activities.push({
        id: deal.id,
        type: deal.ganho ? 'deal_won' : 'new_deal',
        text: deal.ganho 
          ? `Negócio fechado: ${deal.titulo}` 
          : `Novo negócio: ${deal.titulo}`,
        time: deal.criado_em,
        value: deal.valor,
        contactName: deal.Contato?.nome
      });
    });

    // Ordenar por data
    activities.sort((a, b) => new Date(b.time) - new Date(a.time));

    res.json(activities.slice(0, 10));

  } catch (error) {
    console.error('Erro ao buscar atividades:', error);
    res.json([]); // Retorna array vazio se não houver dados
  }
});

// GET /api/dashboard/performance-data
router.get('/performance-data', async (req, res) => {
  try {
    const diasAtras = parseInt(req.query.days) || 10;
    const dataInicio = new Date();
    dataInicio.setDate(dataInicio.getDate() - diasAtras);

    // Buscar dados REAIS agregados por dia
    const performanceData = await sequelize.query(`
      SELECT 
        DATE(m.criado_em) as data,
        COUNT(DISTINCT CASE WHEN m.remetente_tipo = 'contato' THEN m.conversa_id END) as conversas,
        COUNT(CASE WHEN m.remetente_tipo = 'contato' THEN 1 END) as mensagens_recebidas,
        COUNT(CASE WHEN m.remetente_tipo = 'bot' THEN 1 END) as mensagens_enviadas
      FROM "maya-crm".mensagens m
      JOIN "maya-crm".conversas c ON m.conversa_id = c.id
      WHERE c.empresa_id = :empresaId
        AND m.criado_em >= :dataInicio
      GROUP BY DATE(m.criado_em)
      ORDER BY data ASC
    `, {
      replacements: {
        empresaId: req.empresaId,
        dataInicio
      },
      type: sequelize.QueryTypes.SELECT
    });

    res.json(performanceData);

  } catch (error) {
    console.error('Erro ao buscar dados de performance:', error);
    res.json([]); // Retorna array vazio se não houver dados
  }
});

// GET /api/dashboard/channel-performance
router.get('/channel-performance', async (req, res) => {
  try {
    // Buscar dados REAIS de canais
    const channelData = await Conversa.findAll({
      attributes: [
        'canal_tipo',
        [sequelize.fn('COUNT', sequelize.col('canal_tipo')), 'total']
      ],
      where: { empresa_id: req.empresaId },
      group: ['canal_tipo']
    });

    const totalLeads = channelData.reduce((sum, ch) => sum + parseInt(ch.dataValues.total), 0);

    const formatted = channelData.map(ch => ({
      channel: ch.canal_tipo,
      leads: parseInt(ch.dataValues.total),
      percentage: totalLeads > 0 
        ? Math.round((parseInt(ch.dataValues.total) / totalLeads) * 100) 
        : 0
    }));

    res.json(formatted.length > 0 ? formatted : []); // Retorna array vazio se não houver dados

  } catch (error) {
    console.error('Erro ao buscar performance por canal:', error);
    res.json([]);
  }
});

module.exports = router;