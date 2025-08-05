// backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const routes = require('./src/routes');
const { testConnection } = require('./src/database');

const app = express();
const PORT = process.env.PORT || 3001;

// Lista de origens permitidas
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'https://maya-crm-frontend.netlify.app',
  'https://maya-crm.netlify.app',
  process.env.FRONTEND_URL
].filter(Boolean); // Remove valores undefined/null

// Configuração do CORS
const corsOptions = {
  origin: function (origin, callback) {
    // Permite requisições sem origin (Postman, apps mobile, etc)
    if (!origin) {
      return callback(null, true);
    }
    
    // Verifica se a origem está na lista permitida
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // Em desenvolvimento, aceita qualquer localhost
      if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) {
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

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware de logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Testar conexão com banco
testConnection();

// Rotas da API
app.use('/api', routes);

// Rota de teste
app.get('/', (req, res) => {
  res.json({ 
    message: 'Maya CRM API', 
    version: '1.0.0',
    status: 'running' 
  });
});

// Socket.io desabilitado temporariamente
// TODO: Implementar Socket.io quando necessário

// Tratamento de erro 404
app.use((req, res) => {
  // Ignorar logs de socket.io
  if (!req.path.includes('socket.io')) {
    console.log(`404 - Rota não encontrada: ${req.path}`);
  }
  res.status(404).json({ error: 'Rota não encontrada' });
});

// Tratamento de erros
app.use((err, req, res, next) => {
  console.error('Erro:', err);
  res.status(500).json({ 
    error: 'Erro interno do servidor',
    message: err.message 
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`📚 API: http://localhost:${PORT}/api`);
});