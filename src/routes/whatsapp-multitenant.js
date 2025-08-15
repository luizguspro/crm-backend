// backend/src/api/routes/whatsapp-multitenant.js
const express = require('express');
const router = express.Router();
const whatsappMultiTenant = require('../../services/whatsappMultiTenant');
const authMiddleware = require('../../middleware/auth');

// Usar autenticação em todas as rotas
router.use(authMiddleware);

// POST /api/whatsapp/initialize - Inicializar WhatsApp para empresa do usuário
router.post('/initialize', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id || req.empresaId;
    const userId = req.user.id;
    
    if (!empresaId) {
      return res.status(400).json({
        success: false,
        error: 'Empresa não identificada'
      });
    }
    
    const result = await whatsappMultiTenant.initializeForCompany(
      empresaId,
      userId,
      req.io
    );
    
    res.json(result);
    
  } catch (error) {
    console.error('Erro ao inicializar WhatsApp:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/whatsapp/status - Status do WhatsApp da empresa
router.get('/status', (req, res) => {
  try {
    const empresaId = req.user.empresa_id || req.empresaId;
    const status = whatsappMultiTenant.getStatus(empresaId);
    
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

// GET /api/whatsapp/qr - Obter QR Code da empresa
router.get('/qr', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id || req.empresaId;
    const status = whatsappMultiTenant.getStatus(empresaId);
    
    if (status.connected) {
      return res.json({
        success: true,
        connected: true,
        message: 'WhatsApp já está conectado'
      });
    }
    
    // Se tem QR em memória
    if (status.qrCode) {
      const qrcode = require('qrcode');
      const qrDataUrl = await qrcode.toDataURL(status.qrCode);
      
      return res.json({
        success: true,
        connected: false,
        qr: qrDataUrl
      });
    }
    
    // Tentar recuperar do banco (caso tenha sido salvo)
    const { Sequelize } = require('sequelize');
    const db = new Sequelize(process.env.DATABASE_URL, {
      dialect: 'postgres',
      logging: false
    });
    
    const [qrData] = await db.query(`
      SELECT qr_code_temp, qr_code_expira_em
      FROM "maya-crm".canais_integracao
      WHERE empresa_id = :empresaId
      AND tipo = 'whatsapp'
      AND qr_code_expira_em > NOW()
    `, {
      replacements: { empresaId }
    });
    
    if (qrData[0]?.qr_code_temp) {
      return res.json({
        success: true,
        connected: false,
        qr: qrData[0].qr_code_temp
      });
    }
    
    res.json({
      success: false,
      message: 'QR Code não disponível. Inicialize o WhatsApp primeiro.'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/whatsapp/disconnect - Desconectar WhatsApp da empresa
router.post('/disconnect', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id || req.empresaId;
    const result = await whatsappMultiTenant.disconnect(empresaId);
    
    res.json(result);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/whatsapp/send - Enviar mensagem
router.post('/send', async (req, res) => {
  try {
    const { number, message } = req.body;
    const empresaId = req.user.empresa_id || req.empresaId;
    
    if (!number || !message) {
      return res.status(400).json({
        success: false,
        error: 'Número e mensagem são obrigatórios'
      });
    }
    
    const result = await whatsappMultiTenant.sendMessage(
      empresaId,
      number,
      message
    );
    
    res.json({
      success: true,
      messageId: result.id?.id
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/whatsapp/bot/config - Obter configurações do bot
router.get('/bot/config', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id || req.empresaId;
    
    const { Sequelize } = require('sequelize');
    const db = new Sequelize(process.env.DATABASE_URL, {
      dialect: 'postgres',
      logging: false
    });
    
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
    
    res.json({
      success: true,
      config: config[0] || {
        bot_ativo: false,
        bot_mensagem_inicial: '',
        bot_menu_opcoes: [],
        bot_respostas: [],
        bot_delay_resposta: 1,
        bot_transferir_atendente_palavras: ['atendente', 'humano']
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/whatsapp/bot/config - Salvar configurações do bot
router.post('/bot/config', async (req, res) => {
  try {
    const empresaId = req.user.empresa_id || req.empresaId;
    const {
      bot_ativo,
      bot_mensagem_inicial,
      bot_menu_opcoes,
      bot_respostas,
      bot_delay_resposta,
      bot_transferir_atendente_palavras
    } = req.body;
    
    const { Sequelize } = require('sequelize');
    const db = new Sequelize(process.env.DATABASE_URL, {
      dialect: 'postgres',
      logging: false
    });
    
    await db.query(`
      INSERT INTO "maya-crm".configuracoes_bot
      (empresa_id, bot_ativo, bot_mensagem_inicial, bot_menu_opcoes, 
       bot_respostas, bot_delay_resposta, bot_transferir_atendente_palavras)
      VALUES
      (:empresaId, :bot_ativo, :bot_mensagem_inicial, :bot_menu_opcoes,
       :bot_respostas, :bot_delay_resposta, :bot_transferir_atendente_palavras)
      ON CONFLICT (empresa_id)
      DO UPDATE SET
        bot_ativo = :bot_ativo,
        bot_mensagem_inicial = :bot_mensagem_inicial,
        bot_menu_opcoes = :bot_menu_opcoes,
        bot_respostas = :bot_respostas,
        bot_delay_resposta = :bot_delay_resposta,
        bot_transferir_atendente_palavras = :bot_transferir_atendente_palavras,
        atualizado_em = NOW()
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
    
    res.json({
      success: true,
      message: 'Configurações do bot salvas com sucesso'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/whatsapp/admin/connections - Admin: Ver todas as conexões (super admin apenas)
router.get('/admin/connections', async (req, res) => {
  try {
    // Verificar se é super admin
    if (req.user.tipo !== 'super_admin') {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado'
      });
    }
    
    const connections = whatsappMultiTenant.getAllConnections();
    
    res.json({
      success: true,
      connections
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;