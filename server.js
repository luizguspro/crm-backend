// backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const routes = require('./src/routes');
const { testConnection } = require('./src/database');

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

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