// backend/src/api/routes/whatsapp.js
const express = require('express');
const router = express.Router();
const whatsappService = require('../../services/whatsappService');
const authMiddleware = require('../../middleware/auth');
const logger = require('../../../../shared/utils/logger');

// Usar middleware de autenticação
router.use(authMiddleware);

// GET /api/whatsapp/status - Status da conexão
router.get('/status', (req, res) => {
  try {
    const status = whatsappService.getStatus();
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    logger.error('Erro ao buscar status:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erro ao buscar status do WhatsApp' 
    });
  }
});

// POST /api/whatsapp/initialize - Inicializar WhatsApp
router.post('/initialize', (req, res) => {
  try {
    if (whatsappService.isReady) {
      return res.json({
        success: true,
        message: 'WhatsApp já está conectado',
        status: whatsappService.getStatus()
      });
    }
    
    // Inicializar com Socket.io se disponível
    const io = req.io;
    whatsappService.initialize(io);
    
    res.json({
      success: true,
      message: 'Inicializando WhatsApp...',
      status: 'initializing'
    });
  } catch (error) {
    logger.error('Erro ao inicializar WhatsApp:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erro ao inicializar WhatsApp' 
    });
  }
});

// GET /api/whatsapp/qr - Obter QR Code atual
router.get('/qr', async (req, res) => {
  try {
    if (whatsappService.isReady) {
      return res.json({
        success: true,
        connected: true,
        message: 'WhatsApp já está conectado'
      });
    }
    
    if (!whatsappService.qrCode) {
      return res.json({
        success: false,
        message: 'QR Code não disponível. Inicialize o WhatsApp primeiro.'
      });
    }
    
    const qrcode = require('qrcode');
    const qrDataUrl = await qrcode.toDataURL(whatsappService.qrCode);
    
    res.json({
      success: true,
      qr: qrDataUrl,
      connected: false
    });
  } catch (error) {
    logger.error('Erro ao gerar QR Code:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erro ao gerar QR Code' 
    });
  }
});

// POST /api/whatsapp/disconnect - Desconectar WhatsApp
router.post('/disconnect', async (req, res) => {
  try {
    await whatsappService.disconnect();
    
    res.json({
      success: true,
      message: 'WhatsApp desconectado com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao desconectar WhatsApp:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erro ao desconectar WhatsApp' 
    });
  }
});

// POST /api/whatsapp/send - Enviar mensagem
router.post('/send', async (req, res) => {
  try {
    const { number, message, conversaId } = req.body;
    
    if (!number || !message) {
      return res.status(400).json({
        success: false,
        error: 'Número e mensagem são obrigatórios'
      });
    }
    
    if (!whatsappService.isReady) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp não está conectado'
      });
    }
    
    const result = await whatsappService.sendMessage(number, message, conversaId);
    
    res.json({
      success: true,
      message: 'Mensagem enviada com sucesso',
      messageId: result.id.id
    });
  } catch (error) {
    logger.error('Erro ao enviar mensagem:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erro ao enviar mensagem' 
    });
  }
});

// POST /api/whatsapp/send-bulk - Enviar mensagens em massa
router.post('/send-bulk', async (req, res) => {
  try {
    const { recipients, message } = req.body;
    
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Lista de destinatários inválida'
      });
    }
    
    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Mensagem é obrigatória'
      });
    }
    
    if (!whatsappService.isReady) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp não está conectado'
      });
    }
    
    const results = [];
    const errors = [];
    
    for (const recipient of recipients) {
      try {
        // Delay entre mensagens para evitar ban
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const result = await whatsappService.sendMessage(
          recipient.number,
          message.replace('{nome}', recipient.name || '')
        );
        
        results.push({
          number: recipient.number,
          success: true,
          messageId: result.id.id
        });
      } catch (error) {
        errors.push({
          number: recipient.number,
          success: false,
          error: error.message
        });
      }
    }
    
    res.json({
      success: true,
      sent: results.length,
      failed: errors.length,
      results,
      errors
    });
  } catch (error) {
    logger.error('Erro ao enviar mensagens em massa:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erro ao enviar mensagens' 
    });
  }
});

// GET /api/whatsapp/conversations - Listar conversas do WhatsApp
router.get('/conversations', async (req, res) => {
  try {
    const { Conversa, Contato, Mensagem } = require('../../../../shared/models');
    const { Op } = require('sequelize');
    
    const conversas = await Conversa.findAll({
      where: {
        empresa_id: req.empresaId,
        canal_tipo: 'whatsapp'
      },
      include: [
        {
          model: Contato,
          attributes: ['id', 'nome', 'whatsapp', 'score']
        }
      ],
      order: [['ultima_mensagem_em', 'DESC']],
      limit: 50
    });
    
    // Buscar última mensagem e contagem de não lidas
    const conversasComDetalhes = await Promise.all(
      conversas.map(async (conversa) => {
        const ultimaMensagem = await Mensagem.findOne({
          where: { conversa_id: conversa.id },
          order: [['criado_em', 'DESC']]
        });
        
        const naoLidas = await Mensagem.count({
          where: {
            conversa_id: conversa.id,
            remetente_tipo: 'contato',
            lida: false
          }
        });
        
        return {
          id: conversa.id,
          contact: {
            id: conversa.Contato.id,
            name: conversa.Contato.nome,
            number: conversa.Contato.whatsapp,
            score: conversa.Contato.score
          },
          lastMessage: ultimaMensagem?.conteudo || '',
          lastMessageTime: ultimaMensagem?.criado_em || conversa.criado_em,
          unreadCount: naoLidas,
          status: conversa.status
        };
      })
    );
    
    res.json({
      success: true,
      conversations: conversasComDetalhes
    });
  } catch (error) {
    logger.error('Erro ao buscar conversas:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erro ao buscar conversas' 
    });
  }
});

module.exports = router;