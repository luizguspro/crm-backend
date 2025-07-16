// backend/src/index.js
require('dotenv').config({ path: '../.env' });
const { testConnection } = require('../../shared/database');

async function startAPI() {
  try {
    console.log('=================================');
    console.log('    Maya API - Iniciando...      ');
    console.log('=================================');

    // Testar conexão com banco
    const dbConnected = await testConnection();
    if (!dbConnected) {
      throw new Error('Falha na conexão com o banco de dados');
    }

    // Inicializar dados padrão
    const initDatabase = require('./scripts/initDatabase');
    await initDatabase();

    // Importar server.js que carrega as rotas
    require('./api/server');
    
    // Agora iniciar o servidor através da função startServer
    const { startServer } = require('./api/server');
    
    // Chamar startServer se ela existir
    if (typeof startServer === 'function') {
      await startServer();
    } else {
      // Se não tiver a função, iniciar manualmente
      const { server } = require('./api/server');
      const PORT = process.env.API_PORT || 3001;
      
      server.listen(PORT, () => {
        console.log(`🚀 API Server rodando na porta ${PORT}`);
        console.log(`📍 Teste em: http://localhost:${PORT}/api/health`);
      });
    }

  } catch (error) {
    console.error('Erro fatal ao iniciar API:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Tratamento de erros
process.on('uncaughtException', (error) => {
  console.error('Erro não capturado:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Promessa rejeitada não tratada:', reason);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('Recebido SIGINT, encerrando graciosamente...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Recebido SIGTERM, encerrando graciosamente...');
  process.exit(0);
});

// Iniciar API
startAPI();