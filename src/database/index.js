// backend/src/database/index.js
const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

// Configuração do Sequelize
const sequelize = new Sequelize({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'postgres',
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  dialect: 'postgres',
  schema: 'maya-crm', // IMPORTANTE: Definir o schema correto
  logging: (msg) => logger.debug(msg),
  dialectOptions: {
    ssl: process.env.DB_SSL === 'true' ? {
      require: true,
      rejectUnauthorized: false
    } : false
  },
  define: {
    timestamps: true,
    underscored: true,
    freezeTableName: true,
    schema: 'maya-crm' // Definir schema padrão para todos os modelos
  },
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

// Testar conexão
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    logger.info('✅ Conexão com banco de dados estabelecida com sucesso!');
    logger.info(`📁 Usando schema: maya-crm`);
    
    // Verificar se o schema existe
    const [results] = await sequelize.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name = 'maya-crm'
    `);
    
    if (results.length > 0) {
      logger.info('✅ Schema maya-crm encontrado');
    } else {
      logger.error('❌ Schema maya-crm não encontrado!');
    }
    
  } catch (error) {
    logger.error('❌ Erro ao conectar com banco de dados:', error);
    throw error;
  }
};

// Sincronizar modelos (apenas em desenvolvimento)
const syncDatabase = async () => {
  try {
    if (process.env.NODE_ENV === 'development' && process.env.DB_SYNC === 'true') {
      await sequelize.sync({ alter: true });
      logger.info('✅ Modelos sincronizados com o banco de dados');
    }
  } catch (error) {
    logger.error('❌ Erro ao sincronizar modelos:', error);
  }
};

module.exports = {
  sequelize,
  testConnection,
  syncDatabase
};