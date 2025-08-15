// backend/src/api/routes/whatsapp.js
const express = require('express');
const router = express.Router();
const { Sequelize } = require('sequelize');

// Usar o serviço WhatsApp existente
let whatsappService;
try {
  whatsappService = require('../../services/whatsappService');
} catch (error) {
  console.log('WhatsApp Service não encontrado, usando mock');
  whatsappService = {
    isReady: false,
    initialize: () => console.log('Mock: initialize'),
    disconnect: () => console.log('Mock: disconnect'),
    getStatus: () => ({ connected: false }),
    sendMessage: async () => ({ id: { id: 'mock' } })
  };
}

// Middleware simples para pegar empresa_id
const getEmpresaId = (req) => {
  return req.user?.empresa_id || 
         req.empresaId || 
         process.env.DEFAULT_EMPRESA_ID || 
         '00000000-0000-0000-0000-000000000001';
};

// GET /api/whatsapp/status
router.get('/status', (req, res) => {
  try {
    const status = whatsappService.getStatus();
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// POST /api/whatsapp/initialize
router.post('/initialize', (req, res) => {
  try {
    if (whatsappService.isReady) {
      return res.json({
        success: true,
        message: 'WhatsApp já está conectado',
        status: 'connected'
      });
    }
    
    whatsappService.initialize(req.io);
    
    res.json({
      success: true,
      message: 'Inicializando WhatsApp...',
      status: 'initializing'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// GET /api/whatsapp/qr
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
        connected: false,
        message: 'QR Code não disponível'
      });
    }
    
    const qrcode = require('qrcode');
    const qrDataUrl = await qrcode.toDataURL(whatsappService.qrCode);
    
    res.json({
      success: true,
      connected: false,
      qr: qrDataUrl
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// POST /api/whatsapp/disconnect
router.post('/disconnect', async (req, res) => {
  try {
    await whatsappService.disconnect();
    res.json({
      success: true,
      message: 'WhatsApp desconectado'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// POST /api/whatsapp/send
router.post('/send', async (req, res) => {
  try {
    const { number, message } = req.body;
    
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
    
    const result = await whatsappService.sendMessage(number, message);
    
    res.json({
      success: true,
      message: 'Mensagem enviada',
      messageId: result.id?.id
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// GET /api/whatsapp/bot/config - Configurações do bot
router.get('/bot/config', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    
    const db = new Sequelize(
      process.env.DATABASE_URL || 
      `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
      {
        dialect: 'postgres',
        logging: false
      }
    );
    
    const [config] = await db.query(`
      SELECT 
        bot_ativo,
        bot_mensagem_inicial,
        bot_menu_opcoes,
        bot_respostas,
        bot_delay_resposta,
        bot_transferir_atendente_palavras
      FROM "maya-crm".configuracoes_bot
      WHERE empresa_id = :empresaId
    `, {
      replacements: { empresaId }
    });
    
    // Se não existe configuração, retornar padrão
    const defaultConfig = {
      bot_ativo: false,
      bot_mensagem_inicial: 'Olá! Como posso ajudar?',
      bot_menu_opcoes: [],
      bot_respostas: [],
      bot_delay_resposta: 1,
      bot_transferir_atendente_palavras: ['atendente', 'humano']
    };
    
    res.json({
      success: true,
      config: config[0] || defaultConfig
    });
    
  } catch (error) {
    console.error('Erro ao buscar config do bot:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// POST /api/whatsapp/bot/config - Salvar configurações do bot
router.post('/bot/config', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const {
      bot_ativo,
      bot_mensagem_inicial,
      bot_menu_opcoes,
      bot_respostas,
      bot_delay_resposta,
      bot_transferir_atendente_palavras
    } = req.body;
    
    const db = new Sequelize(
      process.env.DATABASE_URL || 
      `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
      {
        dialect: 'postgres',
        logging: false
      }
    );
    
    // Verificar se já existe
    const [existing] = await db.query(`
      SELECT id FROM "maya-crm".configuracoes_bot
      WHERE empresa_id = :empresaId
    `, {
      replacements: { empresaId }
    });
    
    if (existing.length > 0) {
      // Atualizar
      await db.query(`
        UPDATE "maya-crm".configuracoes_bot
        SET 
          bot_ativo = :bot_ativo,
          bot_mensagem_inicial = :bot_mensagem_inicial,
          bot_menu_opcoes = :bot_menu_opcoes,
          bot_respostas = :bot_respostas,
          bot_delay_resposta = :bot_delay_resposta,
          bot_transferir_atendente_palavras = :bot_transferir_atendente_palavras
        WHERE empresa_id = :empresaId
      `, {
        replacements: {
          empresaId,
          bot_ativo: bot_ativo || false,
          bot_mensagem_inicial: bot_mensagem_inicial || '',
          bot_menu_opcoes: JSON.stringify(bot_menu_opcoes || []),
          bot_respostas: JSON.stringify(bot_respostas || []),
          bot_delay_resposta: bot_delay_resposta || 1,
          bot_transferir_atendente_palavras: JSON.stringify(bot_transferir_atendente_palavras || ['atendente'])
        }
      });
    } else {
      // Inserir
      await db.query(`
        INSERT INTO "maya-crm".configuracoes_bot
        (empresa_id, bot_ativo, bot_mensagem_inicial, bot_menu_opcoes, 
         bot_respostas, bot_delay_resposta, bot_transferir_atendente_palavras)
        VALUES
        (:empresaId, :bot_ativo, :bot_mensagem_inicial, :bot_menu_opcoes,
         :bot_respostas, :bot_delay_resposta, :bot_transferir_atendente_palavras)
      `, {
        replacements: {
          empresaId,
          bot_ativo: bot_ativo || false,
          bot_mensagem_inicial: bot_mensagem_inicial || '',
          bot_menu_opcoes: JSON.stringify(bot_menu_opcoes || []),
          bot_respostas: JSON.stringify(bot_respostas || []),
          bot_delay_resposta: bot_delay_resposta || 1,
          bot_transferir_atendente_palavras: JSON.stringify(bot_transferir_atendente_palavras || ['atendente'])
        }
      });
    }
    
    res.json({
      success: true,
      message: 'Configurações do bot salvas com sucesso'
    });
    
  } catch (error) {
    console.error('Erro ao salvar config do bot:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

module.exports = router;