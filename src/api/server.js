// backend/src/api/server.js
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const logger = require('../../../shared/utils/logger');
const pipelineAutomation = require('../services/pipelineAutomation');
const whatsappService = require('../services/whatsappService'); // ADICIONADO
const { testConnection } = require('../../../shared/database');
const initDatabase = require('../database/init');

const app = express();
const server = http.createServer(app);

// Configuração de CORS para múltiplas origens
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5174',
  'https://maya-crm-frontend.netlify.app',
  'https://68951caf55cbb45a563a36ce--maya-crm-frontend.netlify.app',
  'https://maya-crm.netlify.app'
];

const corsOptions = {
  origin: function (origin, callback) {
    // Permite requisições sem origin (ex: Postman, apps mobile)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // Em desenvolvimento, aceita qualquer origem
      if (process.env.NODE_ENV !== 'production') {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count']
};

// Socket.io com mesma configuração CORS
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  }
});

// Middlewares
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware para adicionar io ao req
app.use((req, res, next) => {
  req.io = io;
  req.empresaId = process.env.DEFAULT_EMPRESA_ID || '00000000-0000-0000-0000-000000000001';
  next();
});

// Middleware de log
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Rota de teste
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    database: 'connected',
    automation: pipelineAutomation.isRunning ? 'running' : 'stopped',
    whatsapp: whatsappService.isReady ? 'connected' : 'disconnected' // ADICIONADO
  });
});

// Função para carregar rotas com tratamento de erro individual
function loadRoute(routeName, routePath) {
  try {
    console.log(`\n========================================`);
    console.log(`Tentando carregar ${routeName} de ${routePath}`);
    console.log(`Caminho absoluto: ${path.resolve(__dirname, routePath)}.js`);
    
    const route = require(routePath);
    
    console.log(`✅ ${routeName} carregado com sucesso`);
    console.log(`Tipo do módulo: ${typeof route}`);
    console.log(`É um Router? ${route && route.name === 'router'}`);
    console.log(`========================================\n`);
    
    logger.info(`✅ ${routeName} routes carregadas`);
    return route;
  } catch (error) {
    console.error(`\n❌ ERRO ao carregar ${routeName}:`);
    console.error(`Mensagem: ${error.message}`);
    console.error(`Code: ${error.code}`);
    console.error(`RequireStack: ${error.requireStack ? error.requireStack.join('\n') : 'N/A'}`);
    
    logger.error(`❌ Erro ao carregar ${routeName}:`, error.message);
    logger.error(`   Arquivo: ${routePath}`);
    
    // Se for erro de módulo não encontrado, mostrar qual módulo
    if (error.code === 'MODULE_NOT_FOUND') {
      console.error(`\nAnalisando erro MODULE_NOT_FOUND...`);
      // Extrair o nome do módulo da mensagem de erro
      const moduleMatch = error.message.match(/Cannot find module '(.+)'/);
      if (moduleMatch) {
        console.error(`Módulo específico não encontrado: ${moduleMatch[1]}`);
        
        // Se for um caminho relativo, mostrar o caminho completo esperado
        if (moduleMatch[1].startsWith('.')) {
          const fromFile = error.requireStack ? error.requireStack[0] : 'unknown';
          console.error(`Tentando importar de: ${fromFile}`);
          console.error(`Caminho relativo: ${moduleMatch[1]}`);
          const expectedPath = path.resolve(path.dirname(fromFile), moduleMatch[1]);
          console.error(`Caminho esperado: ${expectedPath}`);
        }
      }
    }
    
    console.error(`\nStack trace completo:`);
    console.error(error.stack);
    console.error(`========================================\n`);
    
    return null;
  }
}

// Importar e usar rotas
logger.info('Carregando rotas da API...');
console.log('\n🚀 INICIANDO CARREGAMENTO DE ROTAS...\n');

const routes = [
  { name: 'auth', path: './routes/auth', url: '/api/auth' },
  { name: 'dashboard', path: './routes/dashboard', url: '/api/dashboard' },
  { name: 'conversations', path: './routes/conversations', url: '/api/conversations' },
  { name: 'pipeline', path: './routes/pipeline', url: '/api/pipeline' },
  { name: 'contacts', path: './routes/contacts', url: '/api/contacts' },
  { name: 'automation', path: './routes/automation', url: '/api/automation' },
  { name: 'whatsapp', path: './routes/whatsapp', url: '/api/whatsapp' } // ADICIONADO
];

let loadedRoutes = 0;
let failedRoutes = [];

for (const { name, path: routePath, url } of routes) {
  const route = loadRoute(name, routePath);
  if (route) {
    app.use(url, route);
    loadedRoutes++;
  } else {
    failedRoutes.push(name);
    
    // Criar rota fallback para rotas que falharam
    const fallbackRouter = express.Router();
    fallbackRouter.all('*', (req, res) => {
      res.status(503).json({ 
        error: `Serviço ${name} temporariamente indisponível`,
        message: 'Rota em manutenção'
      });
    });
    app.use(url, fallbackRouter);
  }
}

console.log('\n📊 RESUMO DO CARREGAMENTO DE ROTAS:');
console.log(`Total de rotas: ${routes.length}`);
console.log(`Rotas carregadas com sucesso: ${loadedRoutes}`);
console.log(`Rotas com erro: ${failedRoutes.length}`);
if (failedRoutes.length > 0) {
  console.log(`Rotas que falharam: ${failedRoutes.join(', ')}`);
}
console.log('\n');

logger.info(`📊 Rotas carregadas: ${loadedRoutes}/${routes.length}`);
if (failedRoutes.length > 0) {
  logger.warn(`⚠️ Rotas com erro: ${failedRoutes.join(', ')}`);
}

// Se a rota auth foi carregada mas não está funcionando, vamos adicionar um teste
app.get('/api/test-auth', (req, res) => {
  res.json({ 
    message: 'Teste de auth',
    authRouteLoaded: !failedRoutes.includes('auth')
  });
});

// Rota de debug para verificar estrutura
app.get('/api/debug/routes', (req, res) => {
  const registeredRoutes = [];
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      registeredRoutes.push({
        path: middleware.route.path,
        methods: Object.keys(middleware.route.methods)
      });
    } else if (middleware.name === 'router') {
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          registeredRoutes.push({
            path: handler.route.path,
            methods: Object.keys(handler.route.methods)
          });
        }
      });
    }
  });
  
  res.json({
    loadedRoutes: routes.filter(r => !failedRoutes.includes(r.name)),
    failedRoutes: failedRoutes,
    registeredEndpoints: registeredRoutes
  });
});

// Rota de fallback para 404
app.use('/api/*', (req, res) => {
  logger.warn(`Rota não encontrada: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: 'Endpoint não encontrado',
    path: req.originalUrl,
    method: req.method,
    availableRoutes: routes.filter(r => !failedRoutes.includes(r.name)).map(r => r.url)
  });
});

// Socket.io para atualizações em tempo real
io.on('connection', (socket) => {
  logger.info(`Cliente conectado: ${socket.id}`);
  
  socket.on('join-company', (empresaId) => {
    socket.join(`empresa-${empresaId}`);
    logger.info(`Socket ${socket.id} entrou na sala empresa-${empresaId}`);
  });
  
  socket.on('disconnect', () => {
    logger.info(`Cliente desconectado: ${socket.id}`);
  });
});

// Função para iniciar o servidor
async function startServer() {
  try {
    // Verificar conexão com banco
    const dbConnected = await testConnection();
    if (!dbConnected) {
      throw new Error('Não foi possível conectar ao banco de dados');
    }
    
    // Inicializar banco
    await initDatabase();
    
    // Iniciar servidor HTTP
    const PORT = process.env.API_PORT || 3001;
    
    return new Promise((resolve, reject) => {
      server.listen(PORT, (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        logger.info(`🚀 API Server rodando na porta ${PORT}`);
        logger.info(`📍 Endpoints disponíveis:`);
        
        // Sempre disponíveis
        logger.info(`   - GET  /api/health`);
        logger.info(`   - GET  /api/test-auth`);
        logger.info(`   - GET  /api/debug/routes`);
        
        // Listar apenas rotas que foram carregadas com sucesso
        if (!failedRoutes.includes('auth')) {
          logger.info(`   - POST /api/auth/login`);
          logger.info(`   - GET  /api/auth/me`);
          logger.info(`   - POST /api/auth/register`);
          logger.info(`   - POST /api/auth/logout`);
        }
        
        if (!failedRoutes.includes('dashboard')) {
          logger.info(`   - GET  /api/dashboard/kpis`);
          logger.info(`   - GET  /api/dashboard/recent-activities`);
          logger.info(`   - GET  /api/dashboard/performance-data`);
          logger.info(`   - GET  /api/dashboard/channel-performance`);
        }
        
        if (!failedRoutes.includes('conversations')) {
          logger.info(`   - GET  /api/conversations`);
          logger.info(`   - GET  /api/conversations/:id`);
          logger.info(`   - POST /api/conversations/:id/messages`);
        }
        
        if (!failedRoutes.includes('pipeline')) {
          logger.info(`   - GET  /api/pipeline/stages`);
          logger.info(`   - GET  /api/pipeline/deals`);
          logger.info(`   - POST /api/pipeline/deals`);
          logger.info(`   - PUT  /api/pipeline/deals/:id`);
          logger.info(`   - PUT  /api/pipeline/deals/:id/move`);
        }
        
        if (!failedRoutes.includes('contacts')) {
          logger.info(`   - GET  /api/contacts`);
          logger.info(`   - POST /api/contacts`);
          logger.info(`   - PUT  /api/contacts/:id`);
          logger.info(`   - DELETE /api/contacts/:id`);
        }
        
        if (!failedRoutes.includes('automation')) {
          logger.info(`   - GET  /api/automation/status`);
          logger.info(`   - POST /api/automation/start`);
          logger.info(`   - POST /api/automation/stop`);
          logger.info(`   - POST /api/automation/run-now`);
        }
        
        // ADICIONADO - Rotas do WhatsApp
        if (!failedRoutes.includes('whatsapp')) {
          logger.info(`   - GET  /api/whatsapp/status`);
          logger.info(`   - POST /api/whatsapp/initialize`);
          logger.info(`   - GET  /api/whatsapp/qr`);
          logger.info(`   - POST /api/whatsapp/disconnect`);
          logger.info(`   - POST /api/whatsapp/send`);
          logger.info(`   - POST /api/whatsapp/send-bulk`);
          logger.info(`   - GET  /api/whatsapp/conversations`);
        }
        
        // Iniciar automação do pipeline apenas se a rota foi carregada
        if (!failedRoutes.includes('pipeline') && !failedRoutes.includes('automation')) {
          logger.info('🤖 Iniciando serviço de automação do pipeline...');
          pipelineAutomation.start();
        } else {
          logger.warn('⚠️ Automação do pipeline não iniciada devido a rotas faltantes');
        }
        
        // ADICIONADO - Inicializar WhatsApp automaticamente se configurado
        if (process.env.WHATSAPP_AUTO_START === 'true' && !failedRoutes.includes('whatsapp')) {
          logger.info('📱 Iniciando WhatsApp Service automaticamente...');
          whatsappService.initialize(io);
        } else {
          logger.info('📱 WhatsApp em modo manual. Use /api/whatsapp/initialize para conectar');
        }
        
        resolve();
      });
    });
    
  } catch (error) {
    logger.error('Erro ao iniciar servidor:', error);
    throw error;
  }
}

// NÃO INICIAR O SERVIDOR AUTOMATICAMENTE - deixar o index.js controlar
// Apenas exportar tudo que é necessário
module.exports = { app, server, io, startServer };