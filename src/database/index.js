// backend/src/database/index.js
const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

// Usar DATABASE_URL se disponível, senão montar a URL
const databaseUrl = process.env.DATABASE_URL || 
  `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

// Configuração do Sequelize
const sequelize = new Sequelize(databaseUrl, {
  dialect: 'postgres',
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
    schema: 'maya-crm'
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
    logger.info(`📁 Banco: ${process.env.DB_NAME || 'maya-crm'}`);
    logger.info(`🔌 Host: ${process.env.DB_HOST || 'localhost'}`);
    
    // Verificar se o schema existe
    const [results] = await sequelize.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name = 'maya-crm'
    `);
    
    if (results.length > 0) {
      logger.info('✅ Schema maya-crm encontrado');
    } else {
      logger.warn('⚠️ Schema maya-crm não encontrado!');
      
      // Tentar criar o schema
      try {
        await sequelize.query('CREATE SCHEMA IF NOT EXISTS "maya-crm"');
        logger.info('✅ Schema maya-crm criado com sucesso');
      } catch (err) {
        logger.error('❌ Erro ao criar schema:', err.message);
      }
    }
    
  } catch (error) {
    logger.error('❌ Erro ao conectar com banco de dados:', error.message);
    
    // Fornecer dicas sobre o erro
    if (error.message.includes('senha')) {
      logger.error('💡 Verifique se a senha está correta no arquivo .env');
      logger.error('💡 Senha esperada: DB_PASSWORD no arquivo .env');
    }
    if (error.message.includes('ECONNREFUSED')) {
      logger.error('💡 Verifique se o PostgreSQL está rodando');
      logger.error('💡 Comando para iniciar: pg_ctl start (Windows) ou sudo service postgresql start (Linux)');
    }
    if (error.message.includes('database') && error.message.includes('does not exist')) {
      logger.error('💡 O banco maya-crm não existe. Crie com: CREATE DATABASE "maya-crm"');
    }
    
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