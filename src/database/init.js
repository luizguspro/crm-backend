// backend/src/database/init.js
const { sequelize, testConnection } = require('./index');
const logger = require('../utils/logger');

const initDatabase = async () => {
  try {
    // Testar conexão
    await testConnection();
    
    // Verificar se as tabelas existem no schema maya-crm
    const tables = [
      'empresas',
      'usuarios',
      'contatos',
      'conversas',
      'mensagens',
      'pipeline_etapas',
      'negocios',
      'negocios_historico',
      'tarefas',
      'automacao_fluxos',
      'automacao_execucoes'
    ];
    
    logger.info('🔍 Verificando tabelas no schema maya-crm...');
    
    for (const table of tables) {
      const [results] = await sequelize.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'maya-crm' 
        AND table_name = :table
      `, {
        replacements: { table },
        type: sequelize.QueryTypes.SELECT
      });
      
      if (results) {
        logger.info(`✅ Tabela ${table} encontrada`);
      } else {
        logger.warn(`⚠️ Tabela ${table} não encontrada`);
      }
    }
    
    // Inserir empresa padrão se não existir
    const empresaId = process.env.DEFAULT_EMPRESA_ID || '00000000-0000-0000-0000-000000000001';
    
    const [empresa] = await sequelize.query(`
      SELECT id FROM "maya-crm".empresas WHERE id = :empresaId
    `, {
      replacements: { empresaId },
      type: sequelize.QueryTypes.SELECT
    });
    
    if (!empresa) {
      logger.info('📝 Criando empresa padrão...');
      await sequelize.query(`
        INSERT INTO "maya-crm".empresas (id, nome, email, plano, ativo)
        VALUES (:empresaId, 'Empresa Demo', 'demo@maya-crm.com', 'basico', true)
      `, {
        replacements: { empresaId }
      });
      logger.info('✅ Empresa padrão criada');
    }
    
    // Inserir etapas padrão se não existirem
    const [etapasCount] = await sequelize.query(`
      SELECT COUNT(*) as count 
      FROM "maya-crm".pipeline_etapas 
      WHERE empresa_id = :empresaId
    `, {
      replacements: { empresaId },
      type: sequelize.QueryTypes.SELECT
    });
    
    if (parseInt(etapasCount.count) === 0) {
      logger.info('📝 Criando etapas padrão do pipeline...');
      
      const etapasPadrao = [
        { nome: 'Novos Leads', cor: '#3B82F6', ordem: 1, tipo: 'normal' },
        { nome: 'Qualificados', cor: '#8B5CF6', ordem: 2, tipo: 'normal' },
        { nome: 'Em Negociação', cor: '#F59E0B', ordem: 3, tipo: 'normal' },
        { nome: 'Proposta Enviada', cor: '#EF4444', ordem: 4, tipo: 'normal' },
        { nome: 'Cadência de Contato', cor: '#F97316', ordem: 5, tipo: 'normal' },
        { nome: 'Ganhos', cor: '#10B981', ordem: 6, tipo: 'ganho' },
        { nome: 'Perdidos', cor: '#6B7280', ordem: 7, tipo: 'perdido' }
      ];
      
      for (const etapa of etapasPadrao) {
        await sequelize.query(`
          INSERT INTO "maya-crm".pipeline_etapas 
          (empresa_id, nome, descricao, cor, ordem, tipo, ativo)
          VALUES 
          (:empresaId, :nome, :descricao, :cor, :ordem, :tipo, true)
        `, {
          replacements: {
            empresaId,
            nome: etapa.nome,
            descricao: `Etapa: ${etapa.nome}`,
            cor: etapa.cor,
            ordem: etapa.ordem,
            tipo: etapa.tipo
          }
        });
      }
      
      logger.info('✅ Etapas padrão criadas');
    }
    
    logger.info('✅ Banco de dados inicializado com sucesso!');
    
  } catch (error) {
    logger.error('❌ Erro ao inicializar banco de dados:', error);
    throw error;
  }
};

// Se executado diretamente
if (require.main === module) {
  initDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = initDatabase;