// backend/src/api/routes/conversations.js
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { 
  Contato, 
  Conversa, 
  Mensagem,
  Negocio 
} = require('../../models');

// Middleware temporário para empresa padrão
const setDefaultEmpresa = (req, res, next) => {
  req.empresaId = process.env.DEFAULT_EMPRESA_ID || '00000000-0000-0000-0000-000000000001';
  next();
};

router.use(setDefaultEmpresa);

// GET /api/conversations - Lista todas as conversas REAIS
router.get('/', async (req, res) => {
  try {
    const { status, search, channel } = req.query;
    
    const whereClause = {
      empresa_id: req.empresaId
    };

    if (status && status !== 'all') {
      whereClause.status = status;
    }

    if (channel) {
      whereClause.canal_tipo = channel;
    }

    const conversas = await Conversa.findAll({
      where: whereClause,
      include: [{
        model: Contato,
        attributes: ['id', 'nome', 'email', 'whatsapp', 'empresa', 'score'],
        where: search ? {
          [Op.or]: [
            { nome: { [Op.like]: `%${search}%` } },
            { empresa: { [Op.like]: `%${search}%` } }
          ]
        } : undefined
      }],
      order: [['ultima_mensagem_em', 'DESC']]
    });

    // Se não houver conversas, retorna array vazio
    if (conversas.length === 0) {
      return res.json([]);
    }

    // Buscar detalhes de cada conversa
    const conversasComDetalhes = await Promise.all(
      conversas.map(async (conversa) => {
        // Última mensagem
        const ultimaMensagem = await Mensagem.findOne({
          where: { conversa_id: conversa.id },
          order: [['criado_em', 'DESC']]
        });

        // Mensagens não lidas
        const naoLidas = await Mensagem.count({
          where: {
            conversa_id: conversa.id,
            remetente_tipo: 'contato',
            lida: false
          }
        });

        // Tags do contato
        const tags = ['Cliente', conversa.canal_tipo];
        
        // Valor do lead
        const negocio = await Negocio.findOne({
          where: {
            contato_id: conversa.contato_id,
            ganho: null
          },
          order: [['criado_em', 'DESC']]
        });

        return {
          id: conversa.id,
          contact: {
            id: conversa.Contato.id,
            name: conversa.Contato.nome,
            company: conversa.Contato.empresa || 'Não informado',
            avatar: conversa.Contato.nome.charAt(0).toUpperCase(),
            status: conversa.status === 'aberta' ? 'online' : 'offline',
            phone: conversa.Contato.whatsapp,
            email: conversa.Contato.email,
            tags: tags,
            leadValue: negocio?.valor || 0,
            stage: negocio?.etapa_id || 'Primeiro Contato'
          },
          channel: conversa.canal_tipo,
          lastMessage: ultimaMensagem?.conteudo || 'Nova conversa',
          lastMessageTime: ultimaMensagem?.criado_em || conversa.criado_em,
          unread: naoLidas,
          isBot: conversa.bot_ativo,
          conversationStatus: conversa.status
        };
      })
    );

    res.json(conversasComDetalhes);

  } catch (error) {
    console.error('Erro ao buscar conversas:', error);
    res.json([]); // Retorna array vazio em caso de erro
  }
});

// GET /api/conversations/:id/messages - Mensagens REAIS de uma conversa
router.get('/:id/messages', async (req, res) => {
  try {
    const conversa = await Conversa.findOne({
      where: {
        id: req.params.id,
        empresa_id: req.empresaId
      }
    });

    if (!conversa) {
      return res.json([]); // Retorna array vazio se não encontrar
    }

    const mensagens = await Mensagem.findAll({
      where: { conversa_id: conversa.id },
      order: [['criado_em', 'ASC']]
    });

    // Marcar mensagens como lidas
    await Mensagem.update(
      { lida: true },
      {
        where: {
          conversa_id: conversa.id,
          remetente_tipo: 'contato',
          lida: false
        }
      }
    );

    // Formatar mensagens
    const mensagensFormatadas = mensagens.map(msg => ({
      id: msg.id,
      text: msg.conteudo,
      sender: msg.remetente_tipo === 'contato' ? 'contact' : msg.remetente_tipo,
      time: msg.criado_em,
      status: msg.enviada ? 'sent' : 'error',
      metadata: msg.metadata
    }));

    res.json(mensagensFormatadas);

  } catch (error) {
    console.error('Erro ao buscar mensagens:', error);
    res.json([]);
  }
});

// POST /api/conversations/:id/messages - Enviar mensagem
router.post('/:id/messages', async (req, res) => {
  try {
    const { message } = req.body;
    
    const conversa = await Conversa.findOne({
      where: {
        id: req.params.id,
        empresa_id: req.empresaId
      },
      include: [Contato]
    });

    if (!conversa) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    // Salvar mensagem no banco
    const novaMensagem = await Mensagem.create({
      conversa_id: conversa.id,
      remetente_tipo: 'usuario',
      conteudo: message,
      tipo_conteudo: 'texto'
    });

    // Atualizar última mensagem da conversa
    await conversa.update({
      ultima_mensagem_em: new Date()
    });

    // TODO: Integrar com WhatsApp para enviar a mensagem real

    // Emitir evento via Socket.io
    if (req.io) {
      req.io.to(`empresa-${req.empresaId}`).emit('new-message', {
        conversationId: conversa.id,
        message: {
          id: novaMensagem.id,
          text: novaMensagem.conteudo,
          sender: 'me',
          time: novaMensagem.criado_em,
          status: 'sent'
        }
      });
    }

    res.json({
      success: true,
      message: {
        id: novaMensagem.id,
        text: novaMensagem.conteudo,
        time: novaMensagem.criado_em
      }
    });

  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    res.status(500).json({ error: 'Erro ao enviar mensagem' });
  }
});

module.exports = router;