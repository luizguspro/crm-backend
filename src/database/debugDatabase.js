// backend/src/database/debugDatabase.js
const { sequelize } = require('./index');
const logger = require('../utils/logger');

async function debugDatabase() {
  try {
    logger.info('🔍 Iniciando debug do banco de dados...');

    // Testar conexão
    await sequelize.authenticate();
    logger.info('✅ Conexão estabelecida');

    // Verificar schema atual
    const [currentSchema] = await sequelize.query(
      "SELECT current_schema()",
      { type: sequelize.QueryTypes.SELECT }
    );
    logger.info(`📁 Schema atual: ${currentSchema.current_schema}`);

    // Listar todos os schemas
    const schemas = await sequelize.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema')",
      { type: sequelize.QueryTypes.SELECT }
    );
    logger.info('📋 Schemas disponíveis:');
    schemas.forEach(s => logger.info(`   - ${s.schema_name}`));

    // Listar tabelas no schema public
    const tables = await sequelize.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
      { type: sequelize.QueryTypes.SELECT }
    );
    
    logger.info('\n📊 Tabelas no schema public:');
    tables.forEach(t => logger.info(`   - ${t.tablename}`));

    // Verificar especificamente a tabela negocios
    logger.info('\n🔍 Verificando tabela negocios...');
    
    try {
      const [count] = await sequelize.query(
        "SELECT COUNT(*) as total FROM negocios",
        { type: sequelize.QueryTypes.SELECT }
      );
      logger.info(`✅ Tabela negocios existe! Total de registros: ${count.total}`);
      
      // Mostrar estrutura da tabela
      const columns = await sequelize.query(
        `SELECT column_name, data_type, is_nullable 
         FROM information_schema.columns 
         WHERE table_name = 'negocios' 
         ORDER BY ordinal_position`,
        { type: sequelize.QueryTypes.SELECT }
      );
      
      logger.info('\n📋 Colunas da tabela negocios:');
      columns.forEach(col => {
        logger.info(`   - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
      });
      
    } catch (error) {
      logger.error(`❌ Erro ao acessar tabela negocios: ${error.message}`);
    }

    // Verificar configuração do Sequelize
    logger.info('\n⚙️ Configuração do Sequelize:');
    logger.info(`   - Database: ${sequelize.config.database}`);
    logger.info(`   - Host: ${sequelize.config.host}`);
    logger.info(`   - Dialect: ${sequelize.config.dialect}`);
    logger.info(`   - Schema: ${sequelize.config.schema || 'não definido'}`);

  } catch (error) {
    logger.error('❌ Erro no debug:', error);
  } finally {
    await sequelize.close();
  }
}

// Executar
if (require.main === module) {
  debugDatabase();
}

module.exports = debugDatabase;