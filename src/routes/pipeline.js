// backend/src/routes/pipeline.js
const express = require('express');
const router = express.Router();
const { Sequelize } = require('sequelize');
const authMiddleware = require('../middleware/auth');

// Usar middleware de autenticação em todas as rotas
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

// GET /api/pipeline/stages - Buscar etapas do pipeline
router.get('/stages', async (req, res) => {
  try {
    const empresaId = req.empresaId;
    
    const [etapas] = await sequelize.query(`
      SELECT * FROM "maya-crm".pipeline_etapas 
      WHERE empresa_id = :empresaId 
      AND ativo = true 
      ORDER BY ordem ASC
    `, {
      replacements: { empresaId }
    });
    
    res.json(etapas);
  } catch (error) {
    console.error('Erro ao buscar etapas:', error);
    res.status(500).json({ error: 'Erro ao buscar etapas do pipeline' });
  }
});

// GET /api/pipeline/deals - Buscar negócios com seus contatos
router.get('/deals', async (req, res) => {
  try {
    const empresaId = req.empresaId;
    
    // Buscar todas as etapas primeiro
    const [etapas] = await sequelize.query(`
      SELECT * FROM "maya-crm".pipeline_etapas 
      WHERE empresa_id = :empresaId 
      AND ativo = true 
      ORDER BY ordem ASC
    `, {
      replacements: { empresaId }
    });
    
    // Para cada etapa, buscar os negócios
    const pipeline = await Promise.all(
      etapas.map(async (etapa) => {
        const [negocios] = await sequelize.query(`
          SELECT 
            n.*,
            c.nome as contato_nome,
            c.email as contato_email,
            c.whatsapp as contato_whatsapp,
            c.score as contato_score,
            c.empresa as contato_empresa,
            conv.ultima_mensagem_em,
            conv.canal_tipo
          FROM "maya-crm".negocios n
          LEFT JOIN "maya-crm".contatos c ON n.contato_id = c.id
          LEFT JOIN "maya-crm".conversas conv ON conv.contato_id = c.id
          WHERE n.empresa_id = :empresaId 
          AND n.etapa_id = :etapaId
          AND n.ganho IS NULL
          ORDER BY n.criado_em DESC
        `, {
          replacements: { 
            empresaId,
            etapaId: etapa.id 
          }
        });
        
        // Formatar os leads/negócios
        const leads = negocios.map(negocio => {
          // Tags baseadas em características
          const tags = [];
          if (negocio.origem) tags.push(negocio.origem);
          if (negocio.valor > 50000) tags.push('Alto Valor');
          if (negocio.probabilidade >= 70) tags.push('Quente');
          if (negocio.contato_score >= 80) tags.push('Lead Premium');
          
          return {
            id: negocio.id,
            name: negocio.titulo || `Negócio - ${negocio.contato_nome}`,
            contact: negocio.contato_nome || 'Sem nome',
            value: negocio.valor || 0,
            score: negocio.contato_score || 50,
            tags: tags,
            lastContact: negocio.ultima_mensagem_em 
              ? formatRelativeTime(negocio.ultima_mensagem_em)
              : 'Sem contato',
            lastChannel: negocio.canal_tipo || 'whatsapp',
            phone: negocio.contato_whatsapp,
            email: negocio.contato_email,
            source: negocio.origem || 'WhatsApp',
            notes: []
          };
        });
        
        return {
          id: etapa.id,
          title: etapa.nome,
          color: etapa.cor || '#3B82F6',
          description: etapa.descricao || '',
          leads: leads
        };
      })
    );
    
    res.json(pipeline);
  } catch (error) {
    console.error('Erro ao buscar negócios:', error);
    res.status(500).json({ error: 'Erro ao buscar pipeline' });
  }
});

// POST /api/pipeline/deals - Criar novo negócio
router.post('/deals', async (req, res) => {
  try {
    const empresaId = req.empresaId;
    const { 
      contato_id, 
      titulo, 
      valor, 
      origem,
      etapa_id 
    } = req.body;
    
    // Se não tiver etapa, pegar a primeira
    let etapaId = etapa_id;
    if (!etapaId) {
      const [[primeiraEtapa]] = await sequelize.query(`
        SELECT id FROM "maya-crm".pipeline_etapas 
        WHERE empresa_id = :empresaId 
        AND ordem = 1
      `, {
        replacements: { empresaId }
      });
      etapaId = primeiraEtapa?.id;
    }
    
    const [result] = await sequelize.query(`
      INSERT INTO "maya-crm".negocios 
      (empresa_id, contato_id, etapa_id, titulo, valor, origem, probabilidade)
      VALUES 
      (:empresaId, :contato_id, :etapaId, :titulo, :valor, :origem, 25)
      RETURNING *
    `, {
      replacements: {
        empresaId,
        contato_id,
        etapaId,
        titulo,
        valor: valor || 0,
        origem: origem || 'manual'
      }
    });
    
    res.json({
      success: true,
      negocio: result[0]
    });
  } catch (error) {
    console.error('Erro ao criar negócio:', error);
    res.status(500).json({ error: 'Erro ao criar negócio' });
  }
});

// PUT /api/pipeline/deals/:id/move - Mover negócio entre etapas
router.put('/deals/:id/move', async (req, res) => {
  try {
    const empresaId = req.empresaId;
    const { stageId } = req.body;
    const negocioId = req.params.id;
    
    // Verificar se a etapa é de ganho/perda
    const [[novaEtapa]] = await sequelize.query(`
      SELECT tipo FROM "maya-crm".pipeline_etapas 
      WHERE id = :stageId
    `, {
      replacements: { stageId }
    });
    
    let updateQuery = `
      UPDATE "maya-crm".negocios 
      SET etapa_id = :stageId, atualizado_em = NOW()
    `;
    
    const replacements = {
      stageId,
      negocioId,
      empresaId
    };
    
    if (novaEtapa.tipo === 'ganho') {
      updateQuery += ', ganho = true, fechado_em = NOW(), probabilidade = 100';
    } else if (novaEtapa.tipo === 'perdido') {
      updateQuery += ', ganho = false, fechado_em = NOW(), probabilidade = 0';
    }
    
    updateQuery += ' WHERE id = :negocioId AND empresa_id = :empresaId';
    
    await sequelize.query(updateQuery, { replacements });
    
    res.json({
      success: true,
      message: 'Negócio movido com sucesso'
    });
  } catch (error) {
    console.error('Erro ao mover negócio:', error);
    res.status(500).json({ error: 'Erro ao mover negócio' });
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
  
  if (diffMins < 60) {
    return `${diffMins} min atrás`;
  } else if (diffHours < 24) {
    return `${diffHours}h atrás`;
  } else if (diffDays < 30) {
    return `${diffDays}d atrás`;
  } else {
    return past.toLocaleDateString('pt-BR');
  }
}

module.exports = router;