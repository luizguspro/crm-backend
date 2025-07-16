// backend/src/database/index.js
const { Sequelize } = require('sequelize');
const config = require('../config/database');
const logger = require('../utils/logger');

const env = process.env.NODE_ENV || 'development';
const dbConfig = config[env];

// Criar conexão
const sequelize = new Sequelize(
  dbConfig.database,
  dbConfig.username,
  dbConfig.password,
  {
    host: dbConfig.host,
    dialect: dbConfig.dialect,
    logging: dbConfig.logging,
    timezone: dbConfig.timezone,
    define: dbConfig.define,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  }
);

// Testar conexão
async function testConnection() {
  try {
    await sequelize.authenticate();
    logger.info('✅ Conexão com PostgreSQL estabelecida com sucesso!');
    return true;
  } catch (error) {
    logger.error('❌ Erro ao conectar com PostgreSQL:', error);
    return false;
  }
}

// Models serão importados aqui
const models = {};

// Função para sincronizar models (não usar em produção)
async function syncDatabase(force = false) {
  try {
    await sequelize.sync({ force });
    logger.info('✅ Banco de dados sincronizado');
  } catch (error) {
    logger.error('❌ Erro ao sincronizar banco:', error);
  }
}

module.exports = {
  sequelize,
  Sequelize,
  testConnection,
  syncDatabase,
  models
};