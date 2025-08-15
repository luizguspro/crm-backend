// backend/src/api/routes/conversations.js
const express = require('express');
const router = express.Router();
const { Sequelize, Op } = require('sequelize');

// Configurar Sequelize
const sequelize = new Sequelize(process.env.DATABASE_URL || 
  `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`, {
  dialect: 'postgres',
  logging: false
});

// Middleware para empresa padrão
const setDefaultEmpresa = (req, res, next) => {
  req.empresaId = process.env.DEFAULT_EMPRESA_ID || '00000000-0000-0000-0000-000000000001';
  next();
};

router.use(setDefaultEmpresa);

// GET /api/conversations - Listar todas as conversas
router.get('/', async (req, res) => {
  try {
    const { status, search, channel } = req.query;
    
    // Buscar conversas do banco
    let query = `
      SELECT DISTINCT
        c.id,
        c.canal_tipo as channel,
        c.status,
        c.ultima_mensagem_em as last_message_time,
        c.bot_ativo as is_bot,
        ct.id as contact_id,
        ct.nome as contact_name,
        ct.whatsapp as contact_phone,
        ct.email as contact_email,
        ct.empresa as contact_company,
        ct.score as contact_score,
        (
          SELECT conteudo 
          FROM "maya-crm".mensagens m 
          WHERE m.conversa_id = c.id 
          ORDER BY m.criado_em DESC 
          LIMIT 1
        ) as last_message,
        (
          SELECT COUNT(*) 
          FROM "maya-crm".mensagens m 
          WHERE m.conversa_id = c.id 
          AND m.remetente_tipo = 'contato' 
          AND m.lida = false
        ) as unread_count
      FROM "maya-crm".conversas c
      LEFT JOIN "maya-crm".contatos ct ON c.contato_id = ct.id
      WHERE c.empresa_id = :empresaId
    `;

    const replacements = { empresaId: req.empresaId };

    // Filtros
    if (status && status !== 'all') {
      query += ` AND c.status = :status`;
      replacements.status = status;
    }

    if (channel) {
      query += ` AND c.canal_tipo = :channel`;
      replacements.channel = channel;
    }

    if (search) {
      query += ` AND (ct.nome ILIKE :search OR ct.whatsapp LIKE :search OR ct.empresa ILIKE :search)`;
      replacements.search = `%${search}%`;
    }

    query += ` ORDER BY c.ultima_mensagem_em DESC NULLS LAST`;

    const [conversas] = await sequelize.query(query, { replacements });

    // Formatar resposta
    const formattedConversations = conversas.map(conv => ({
      id: conv.id,
      contact: {
        id: conv.contact_id,
        name: conv.contact_name || 'Sem nome',
        company: conv.contact_company || '',
        avatar: conv.contact_name ? conv.contact_name.charAt(0).toUpperCase() : '?',
        status: conv.status === 'aberta' ? 'online' : 'offline',
        phone: conv.contact_phone,
        email: conv.contact_email,
        tags: [conv.channel || 'whatsapp'],
        leadValue: 0,
        stage: 'Primeiro Contato',
        score: conv.contact_score || 50
      },
      channel: conv.channel || 'whatsapp',
      lastMessage: conv.last_message || 'Nova conversa',
      lastMessageTime: conv.last_message_time,
      unread: parseInt(conv.unread_count) || 0,
      isBot: conv.is_bot || false,
      conversationStatus: conv.status || 'aberta'
    }));

    res.json(formattedConversations);

  } catch (error) {
    console.error('Erro ao buscar conversas:', error);
    res.json([]);
  }
});

// GET /api/conversations/:id/messages - Buscar mensagens de uma conversa
router.get('/:id/messages', async (req, res) => {
  try {
    const conversaId = req.params.id;
    
    // Buscar mensagens
    const [mensagens] = await sequelize.query(`
      SELECT 
        m.id,
        m.conteudo as text,
        m.remetente_tipo as sender_type,
        m.criado_em as time,
        m.enviada as sent,
        m.lida as read,
        m.tipo_conteudo as content_type,
        m.metadata
      FROM "maya-crm".mensagens m
      WHERE m.conversa_id = :conversaId
      ORDER BY m.criado_em ASC
    `, {
      replacements: { conversaId }
    });

    // Marcar como lidas
    await sequelize.query(`
      UPDATE "maya-crm".mensagens 
      SET lida = true 
      WHERE conversa_id = :conversaId 
      AND remetente_tipo = 'contato' 
      AND lida = false
    `, {
      replacements: { conversaId }
    });

    // Formatar mensagens
    const formattedMessages = mensagens.map(msg => ({
      id: msg.id,
      text: msg.text,
      sender: msg.sender_type === 'contato' ? 'contact' : 
              msg.sender_type === 'bot' ? 'bot' : 'me',
      time: msg.time,
      status: msg.sent ? 'sent' : 'error',
      type: msg.content_type || 'text',
      metadata: msg.metadata
    }));

    // Emitir evento de mensagens lidas
    if (req.io) {
      req.io.emit('messages-read', { conversationId: conversaId });
    }

    res.json(formattedMessages);

  } catch (error) {
    console.error('Erro ao buscar mensagens:', error);
    res.json([]);
  }
});

// POST /api/conversations/:id/messages - Enviar mensagem
router.post('/:id/messages', async (req, res) => {
  try {
    const { message, type = 'text' } = req.body;
    const conversaId = req.params.id;
    
    if (!message) {
      return res.status(400).json({ error: 'Mensagem é obrigatória' });
    }

    // Buscar dados da conversa
    const [[conversa]] = await sequelize.query(`
      SELECT 
        c.*,
        ct.whatsapp,
        ct.nome
      FROM "maya-crm".conversas c
      LEFT JOIN "maya-crm".contatos ct ON c.contato_id = ct.id
      WHERE c.id = :conversaId
      AND c.empresa_id = :empresaId
    `, {
      replacements: { 
        conversaId,
        empresaId: req.empresaId 
      }
    });

    if (!conversa) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    // Salvar mensagem no banco
    const [result] = await sequelize.query(`
      INSERT INTO "maya-crm".mensagens 
      (conversa_id, remetente_tipo, conteudo, tipo_conteudo, enviada, lida)
      VALUES 
      (:conversaId, 'usuario', :message, :type, false, true)
      RETURNING *
    `, {
      replacements: {
        conversaId,
        message,
        type
      }
    });

    const novaMensagem = result[0];

    // Atualizar última mensagem da conversa
    await sequelize.query(`
      UPDATE "maya-crm".conversas 
      SET ultima_mensagem_em = NOW()
      WHERE id = :conversaId
    `, {
      replacements: { conversaId }
    });

    // Se for WhatsApp, enviar via WhatsApp
    if (conversa.canal_tipo === 'whatsapp' && conversa.whatsapp) {
      try {
        const whatsappService = require('../../services/whatsappService');
        
        if (whatsappService.isReady) {
          console.log(`Enviando mensagem WhatsApp para ${conversa.whatsapp}`);
          
          await whatsappService.sendMessage(
            conversa.whatsapp,
            message
          );
          
          // Marcar como enviada
          await sequelize.query(`
            UPDATE "maya-crm".mensagens 
            SET enviada = true 
            WHERE id = :id
          `, {
            replacements: { id: novaMensagem.id }
          });
          
          novaMensagem.enviada = true;
        }
      } catch (error) {
        console.error('Erro ao enviar via WhatsApp:', error);
      }
    }

    // Emitir evento via Socket.io
    if (req.io) {
      req.io.emit('new-message', {
        conversationId: conversaId,
        message: {
          id: novaMensagem.id,
          text: message,
          sender: 'me',
          time: novaMensagem.criado_em,
          status: novaMensagem.enviada ? 'sent' : 'pending'
        }
      });
    }

    res.json({
      success: true,
      message: {
        id: novaMensagem.id,
        text: message,
        time: novaMensagem.criado_em,
        sent: novaMensagem.enviada
      }
    });

  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    res.status(500).json({ error: 'Erro ao enviar mensagem' });
  }
});

// POST /api/conversations - Criar nova conversa
router.post('/', async (req, res) => {
  try {
    const { contactId, channel = 'whatsapp' } = req.body;
    
    if (!contactId) {
      return res.status(400).json({ error: 'ID do contato é obrigatório' });
    }

    // Verificar se já existe conversa ativa
    const [[existingConv]] = await sequelize.query(`
      SELECT id FROM "maya-crm".conversas 
      WHERE contato_id = :contactId 
      AND empresa_id = :empresaId
      AND status != 'fechada'
      LIMIT 1
    `, {
      replacements: { 
        contactId,
        empresaId: req.empresaId 
      }
    });

    if (existingConv) {
      return res.json({
        success: true,
        conversationId: existingConv.id,
        existing: true
      });
    }

    // Criar nova conversa
    const [result] = await sequelize.query(`
      INSERT INTO "maya-crm".conversas 
      (empresa_id, contato_id, canal_tipo, status, primeira_mensagem_em)
      VALUES 
      (:empresaId, :contactId, :channel, 'aberta', NOW())
      RETURNING id
    `, {
      replacements: {
        empresaId: req.empresaId,
        contactId,
        channel
      }
    });

    res.json({
      success: true,
      conversationId: result[0].id,
      existing: false
    });

  } catch (error) {
    console.error('Erro ao criar conversa:', error);
    res.status(500).json({ error: 'Erro ao criar conversa' });
  }
});

// PUT /api/conversations/:id/status - Atualizar status
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const conversaId = req.params.id;
    
    const validStatuses = ['aberta', 'em_atendimento', 'aguardando', 'fechada'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Status inválido. Use: ' + validStatuses.join(', ') 
      });
    }

    await sequelize.query(`
      UPDATE "maya-crm".conversas 
      SET status = :status
      WHERE id = :conversaId
      AND empresa_id = :empresaId
    `, {
      replacements: {
        status,
        conversaId,
        empresaId: req.empresaId
      }
    });

    // Emitir evento
    if (req.io) {
      req.io.emit('conversation-status-changed', {
        conversationId: conversaId,
        status: status
      });
    }

    res.json({ success: true, status });

  } catch (error) {
    console.error('Erro ao atualizar status:', error);
    res.status(500).json({ error: 'Erro ao atualizar status' });
  }
});

// GET /api/conversations/summary - Resumo das conversas
router.get('/summary', async (req, res) => {
  try {
    const [summary] = await sequelize.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'aberta') as open,
        COUNT(*) FILTER (WHERE status = 'em_atendimento') as in_progress,
        COUNT(*) FILTER (WHERE status = 'aguardando') as waiting,
        COUNT(*) FILTER (WHERE status = 'fechada' AND DATE(ultima_mensagem_em) = CURRENT_DATE) as closed_today,
        COUNT(*) FILTER (WHERE canal_tipo = 'whatsapp') as whatsapp,
        COUNT(*) FILTER (WHERE canal_tipo = 'instagram') as instagram,
        COUNT(*) FILTER (WHERE canal_tipo = 'facebook') as facebook,
        COUNT(*) as total
      FROM "maya-crm".conversas
      WHERE empresa_id = :empresaId
    `, {
      replacements: { empresaId: req.empresaId }
    });

    res.json(summary[0] || {
      open: 0,
      in_progress: 0,
      waiting: 0,
      closed_today: 0,
      whatsapp: 0,
      instagram: 0,
      facebook: 0,
      total: 0
    });

  } catch (error) {
    console.error('Erro ao buscar resumo:', error);
    res.status(500).json({ error: 'Erro ao buscar resumo' });
  }
});

module.exports = router;