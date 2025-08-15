// backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);

// Configuração CORS
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:3000',
      'https://maya-crm-frontend.netlify.app'
    ];
    
    if (!origin || allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
};

// Socket.io
const io = socketIo(server, {
  cors: corsOptions
});

// Middlewares
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware para adicionar io e empresaId ao req
app.use((req, res, next) => {
  req.io = io;
  req.empresaId = process.env.DEFAULT_EMPRESA_ID || '00000000-0000-0000-0000-000000000001';
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Variável para status do WhatsApp
let whatsappStatus = { isReady: false };

// Tentar carregar o serviço WhatsApp se existir
let whatsappService = null;
try {
  whatsappService = require('./src/services/whatsappService');
  console.log('✅ WhatsApp Service carregado');
} catch (error) {
  console.log('⚠️ WhatsApp Service não encontrado - criando mock');
  whatsappService = {
    isReady: false,
    qrCode: null,
    initialize: (io) => console.log('WhatsApp initialize chamado'),
    disconnect: async () => console.log('WhatsApp disconnect chamado'),
    getStatus: () => ({ connected: false, qrCode: null }),
    sendMessage: async (number, message) => {
      console.log(`Simulando envio para ${number}: ${message}`);
      return { id: { id: 'mock-id' } };
    }
  };
}

// Rotas de teste
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date(),
    whatsapp: whatsappService.isReady ? 'connected' : 'disconnected'
  });
});

app.get('/api', (req, res) => {
  res.json({ 
    message: 'Maya CRM API v1.0',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth/*',
      dashboard: '/api/dashboard/*',
      contacts: '/api/contacts/*',
      conversations: '/api/conversations/*',
      pipeline: '/api/pipeline/*',
      whatsapp: '/api/whatsapp/*'
    }
  });
});

// Importar rotas - com tratamento de erro
const loadRoute = (name, path, mountPath) => {
  try {
    const route = require(path);
    app.use(mountPath, route);
    console.log(`✅ Rota ${name} carregada`);
    return true;
  } catch (error) {
    console.log(`⚠️ Rota ${name} não encontrada: ${error.message}`);
    return false;
  }
};

// Carregar rotas principais
loadRoute('auth', './src/routes/auth', '/api/auth');
loadRoute('dashboard', './src/routes/dashboard', '/api/dashboard');
loadRoute('contacts', './src/routes/contacts', '/api/contacts');
loadRoute('pipeline', './src/routes/pipeline', '/api/pipeline');
loadRoute('conversations', './src/api/routes/conversations', '/api/conversations');

// Carregar rota do WhatsApp ou criar inline
if (!loadRoute('whatsapp', './src/api/routes/whatsapp', '/api/whatsapp')) {
  // Criar rotas básicas do WhatsApp inline
  const whatsappRouter = express.Router();
  
  whatsappRouter.get('/status', (req, res) => {
    res.json(whatsappService.getStatus());
  });
  
  whatsappRouter.post('/initialize', (req, res) => {
    if (whatsappService.isReady) {
      return res.json({
        success: true,
        message: 'WhatsApp já está conectado'
      });
    }
    
    whatsappService.initialize(io);
    res.json({
      success: true,
      message: 'Inicializando WhatsApp...'
    });
  });
  
  whatsappRouter.get('/qr', async (req, res) => {
    if (whatsappService.isReady) {
      return res.json({
        connected: true,
        message: 'WhatsApp já está conectado'
      });
    }
    
    if (!whatsappService.qrCode) {
      return res.json({
        connected: false,
        message: 'QR Code não disponível'
      });
    }
    
    try {
      const qrcode = require('qrcode');
      const qrDataUrl = await qrcode.toDataURL(whatsappService.qrCode);
      
      res.json({
        connected: false,
        qr: qrDataUrl
      });
    } catch (error) {
      res.json({
        connected: false,
        error: 'Erro ao gerar QR Code'
      });
    }
  });
  
  whatsappRouter.post('/disconnect', async (req, res) => {
    await whatsappService.disconnect();
    res.json({
      success: true,
      message: 'WhatsApp desconectado'
    });
  });
  
  whatsappRouter.post('/send', async (req, res) => {
    const { number, message } = req.body;
    
    if (!number || !message) {
      return res.status(400).json({
        error: 'Número e mensagem são obrigatórios'
      });
    }
    
    if (!whatsappService.isReady) {
      return res.status(400).json({
        error: 'WhatsApp não está conectado'
      });
    }
    
    try {
      const result = await whatsappService.sendMessage(number, message);
      res.json({
        success: true,
        message: 'Mensagem enviada',
        messageId: result.id?.id
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  });
  
  app.use('/api/whatsapp', whatsappRouter);
  console.log('✅ Rotas WhatsApp criadas inline');
}

// Socket.io eventos
io.on('connection', (socket) => {
  console.log(`Cliente conectado: ${socket.id}`);
  
  socket.on('join-company', (empresaId) => {
    socket.join(`empresa-${empresaId}`);
    console.log(`Socket ${socket.id} entrou na sala empresa-${empresaId}`);
  });
  
  socket.on('disconnect', () => {
    console.log(`Cliente desconectado: ${socket.id}`);
  });
});

// 404 handler
app.use((req, res) => {
  console.log(`404 - Rota não encontrada: ${req.path}`);
  res.status(404).json({ error: 'Rota não encontrada' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Erro:', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// Testar conexão com banco (simplificado)
async function testDatabaseConnection() {
  try {
    // Tentar carregar Sequelize se existir
    const { Sequelize } = require('sequelize');
    const databaseUrl = process.env.DATABASE_URL || 
      `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'maya-crm'}`;
    
    const sequelize = new Sequelize(databaseUrl, {
      dialect: 'postgres',
      logging: false
    });
    
    await sequelize.authenticate();
    console.log('✅ Conexão com banco de dados estabelecida');
    return true;
  } catch (error) {
    console.log('⚠️ Erro ao conectar com banco:', error.message);
    console.log('⚠️ Continuando sem banco de dados...');
    return false;
  }
}

// Iniciar servidor
async function startServer() {
  try {
    // Testar banco mas não falhar se não conectar
    await testDatabaseConnection();
    
    // Iniciar servidor
    const PORT = process.env.PORT || process.env.API_PORT || 3001;
    
    server.listen(PORT, () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
      console.log(`📍 URL: http://localhost:${PORT}`);
      console.log(`📚 API: http://localhost:${PORT}/api`);
      console.log(`🔍 Health: http://localhost:${PORT}/api/health`);
      
      // Inicializar WhatsApp se configurado
      if (process.env.WHATSAPP_AUTO_START === 'true') {
        console.log('📱 Iniciando WhatsApp automaticamente...');
        whatsappService.initialize(io);
      } else {
        console.log('📱 WhatsApp em modo manual');
        console.log('📱 Para conectar: POST http://localhost:' + PORT + '/api/whatsapp/initialize');
      }
    });
    
  } catch (error) {
    console.error('Erro fatal:', error);
    process.exit(1);
  }
}

// Se executado diretamente
if (require.main === module) {
  startServer();
}

module.exports = { app, server, io };