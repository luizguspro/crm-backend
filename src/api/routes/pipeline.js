// backend/src/api/routes/pipeline.js
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize } = require('../../../../shared/database');
const { 
  Contato, 
  Negocio, 
  PipelineEtapa,
  Conversa,
  Mensagem 
} = require('../../../../shared/models');

// Middleware temporário para empresa padrão
const setDefaultEmpresa = (req, res, next) => {
  req.empresaId = process.env.DEFAULT_EMPRESA_ID || '00000000-0000-0000-0000-000000000001';
  next();
};

router.use(setDefaultEmpresa);

// GET /api/pipeline/stages - Buscar etapas do pipeline
router.get('/stages', async (req, res) => {
  try {
    const etapas = await PipelineEtapa.findAll({
      where: {
        empresa_id: req.empresaId,
        ativo: true
      },
      order: [['ordem', 'ASC']]
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
    // Buscar todas as etapas primeiro
    const etapas = await PipelineEtapa.findAll({
      where: {
        empresa_id: req.empresaId,
        ativo: true
      },
      order: [['ordem', 'ASC']]
    });

    // Buscar negócios agrupados por etapa
    const pipeline = await Promise.all(
      etapas.map(async (etapa) => {
        const negocios = await Negocio.findAll({
          where: {
            empresa_id: req.empresaId,
            etapa_id: etapa.id,
            ganho: null // Apenas negócios em aberto
          },
          include: [{
            model: Contato,
            attributes: ['id', 'nome', 'email', 'whatsapp', 'score', 'empresa']
          }],
          order: [['criado_em', 'DESC']]
        });

        // Formatar os leads/negócios
        const leads = await Promise.all(
          negocios.map(async (negocio) => {
            // Buscar última interação
            const ultimaConversa = await Conversa.findOne({
              where: { contato_id: negocio.contato_id },
              order: [['ultima_mensagem_em', 'DESC']]
            });

            // Buscar tags do contato (simplificado)
            const tags = [];
            if (negocio.origem) tags.push(negocio.origem);
            if (negocio.valor > 50000) tags.push('Alto Valor');
            if (negocio.probabilidade >= 70) tags.push('Quente');

            return {
              id: negocio.id,
              name: negocio.titulo || `Negócio - ${negocio.Contato.nome}`,
              contact: negocio.Contato.nome,
              value: negocio.valor || 0,
              score: negocio.Contato.score || 50,
              tags: tags,
              lastContact: ultimaConversa?.ultima_mensagem_em 
                ? formatRelativeTime(ultimaConversa.ultima_mensagem_em)
                : 'Sem contato',
              lastChannel: ultimaConversa?.canal_tipo || 'whatsapp',
              phone: negocio.Contato.whatsapp,
              email: negocio.Contato.email,
              source: negocio.origem || 'WhatsApp',
              notes: [] // Por enquanto vazio, implementar depois se necessário
            };
          })
        );

        return {
          id: etapa.id,
          title: etapa.nome,
          color: etapa.cor,
          description: etapa.descricao,
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
      const primeiraEtapa = await PipelineEtapa.findOne({
        where: {
          empresa_id: req.empresaId,
          ordem: 1
        }
      });
      etapaId = primeiraEtapa?.id;
    }

    const novoNegocio = await Negocio.create({
      empresa_id: req.empresaId,
      contato_id,
      etapa_id: etapaId,
      titulo,
      valor: valor || 0,
      origem: origem || 'manual',
      probabilidade: 25
    });

    res.json({
      success: true,
      negocio: novoNegocio
    });

  } catch (error) {
    console.error('Erro ao criar negócio:', error);
    res.status(500).json({ error: 'Erro ao criar negócio' });
  }
});

// PUT /api/pipeline/deals/:id/move - Mover negócio entre etapas
router.put('/deals/:id/move', async (req, res) => {
  try {
    const { stageId } = req.body;
    const negocioId = req.params.id;

    const negocio = await Negocio.findOne({
      where: {
        id: negocioId,
        empresa_id: req.empresaId
      }
    });

    if (!negocio) {
      return res.status(404).json({ error: 'Negócio não encontrado' });
    }

    // Verificar se a etapa é de ganho/perda
    const novaEtapa = await PipelineEtapa.findByPk(stageId);
    
    if (novaEtapa.tipo === 'ganho') {
      negocio.ganho = true;
      negocio.fechado_em = new Date();
      negocio.probabilidade = 100;
    } else if (novaEtapa.tipo === 'perdido') {
      negocio.ganho = false;
      negocio.fechado_em = new Date();
      negocio.probabilidade = 0;
    }

    negocio.etapa_id = stageId;
    await negocio.save();

    // Emitir evento via Socket.io
    if (req.io) {
      req.io.to(`empresa-${req.empresaId}`).emit('deal-moved', {
        dealId: negocioId,
        fromStage: negocio.etapa_id,
        toStage: stageId
      });
    }

    res.json({
      success: true,
      negocio
    });

  } catch (error) {
    console.error('Erro ao mover negócio:', error);
    res.status(500).json({ error: 'Erro ao mover negócio' });
  }
});

// PUT /api/pipeline/deals/:id - Atualizar negócio
router.put('/deals/:id', async (req, res) => {
  try {
    const negocioId = req.params.id;
    const updates = req.body;

    const negocio = await Negocio.findOne({
      where: {
        id: negocioId,
        empresa_id: req.empresaId
      }
    });

    if (!negocio) {
      return res.status(404).json({ error: 'Negócio não encontrado' });
    }

    await negocio.update(updates);

    res.json({
      success: true,
      negocio
    });

  } catch (error) {
    console.error('Erro ao atualizar negócio:', error);
    res.status(500).json({ error: 'Erro ao atualizar negócio' });
  }
});

// Função auxiliar para formatar tempo relativo
function formatRelativeTime(date) {
  const now = new Date();
  const past = new Date(date);
  const diffInSeconds = Math.floor((now - past) / 1000);
  
  if (diffInSeconds < 60) return 'agora';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} min atrás`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h atrás`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)} dias atrás`;
  
  return past.toLocaleDateString('pt-BR');
}

module.exports = router;