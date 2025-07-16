// backend/src/scripts/checkDatabase.js
require('dotenv').config({ path: '../../.env' });
const { sequelize } = require('@maya-crm/shared/database');
const logger = require('@maya-crm/shared/utils/logger');

async function checkDatabase() {
  try {
    logger.info('Verificando estrutura do banco...');

    // Verificar colunas da tabela canais_integracao
    const [columns] = await sequelize.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'maya-crm' 
      AND table_name = 'canais_integracao'
      ORDER BY ordinal_position
    `);

    logger.info('Colunas encontradas em canais_integracao:');
    columns.forEach(col => {
      logger.info(`  - ${col.column_name} (${col.data_type})`);
    });

    // Se não tiver a coluna configuracoes, adicionar
    const hasConfiguracoes = columns.some(col => col.column_name === 'configuracoes');
    
    if (!hasConfiguracoes) {
      logger.info('Coluna configuracoes não encontrada. Adicionando...');
      
      await sequelize.query(`
        ALTER TABLE "maya-crm".canais_integracao 
        ADD COLUMN IF NOT EXISTS configuracoes JSONB DEFAULT '{}'::jsonb
      `);
      
      logger.info('✅ Coluna configuracoes adicionada');
    }

    // Verificar se existe a coluna configuracao (sem S) e removê-la
    const hasConfiguracao = columns.some(col => col.column_name === 'configuracao');
    
    if (hasConfiguracao) {
      logger.info('Coluna configuracao (antiga) encontrada. Migrando dados...');
      
      // Copiar dados se existirem
      await sequelize.query(`
        UPDATE "maya-crm".canais_integracao 
        SET configuracoes = configuracao 
        WHERE configuracao IS NOT NULL 
        AND configuracoes IS NULL
      `);
      
      // Remover coluna antiga
      await sequelize.query(`
        ALTER TABLE "maya-crm".canais_integracao 
        DROP COLUMN IF EXISTS configuracao
      `);
      
      logger.info('✅ Migração concluída');
    }

    logger.info('✅ Verificação do banco concluída');
    
  } catch (error) {
    logger.error('Erro ao verificar banco:', error);
  } finally {
    await sequelize.close();
  }
}

// Executar
checkDatabase();