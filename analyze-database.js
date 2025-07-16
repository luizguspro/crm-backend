// analyze-database.js
// Execute na pasta backend: node analyze-database.js

require('dotenv').config();
const { Sequelize } = require('sequelize');
const fs = require('fs');

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  logging: false
});

async function analyzeDatabase() {
  console.log('🔍 Analisando estrutura do banco de dados Maya CRM...\n');
  
  try {
    await sequelize.authenticate();
    console.log('✅ Conectado ao banco\n');
    
    // 1. Listar todas as tabelas
    console.log('📋 TABELAS NO SCHEMA maya-crm:\n');
    const [tables] = await sequelize.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'maya-crm' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    console.log('Tabelas encontradas:', tables.length);
    tables.forEach(t => console.log(`  - ${t.table_name}`));
    
    // 2. Analisar cada tabela
    console.log('\n📊 ESTRUTURA DETALHADA DE CADA TABELA:\n');
    
    const tableStructures = {};
    
    for (const table of tables) {
      const tableName = table.table_name;
      console.log(`\n========== ${tableName.toUpperCase()} ==========`);
      
      // Buscar colunas
      const [columns] = await sequelize.query(`
        SELECT 
          column_name,
          data_type,
          character_maximum_length,
          is_nullable,
          column_default,
          udt_name
        FROM information_schema.columns
        WHERE table_schema = 'maya-crm' 
        AND table_name = :tableName
        ORDER BY ordinal_position
      `, {
        replacements: { tableName }
      });
      
      tableStructures[tableName] = columns;
      
      console.log('Colunas:');
      columns.forEach(col => {
        const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        const length = col.character_maximum_length ? `(${col.character_maximum_length})` : '';
        const defaultVal = col.column_default ? ` DEFAULT ${col.column_default}` : '';
        console.log(`  - ${col.column_name}: ${col.data_type}${length} ${nullable}${defaultVal}`);
      });
      
      // Contar registros
      try {
        const [[count]] = await sequelize.query(
          `SELECT COUNT(*) as total FROM "maya-crm".${tableName}`
        );
        console.log(`\nTotal de registros: ${count.total}`);
        
        // Mostrar alguns exemplos se houver dados
        if (count.total > 0 && count.total < 100) {
          console.log('\nExemplos de dados:');
          const [samples] = await sequelize.query(
            `SELECT * FROM "maya-crm".${tableName} LIMIT 3`
          );
          samples.forEach((sample, index) => {
            console.log(`\nRegistro ${index + 1}:`);
            Object.entries(sample).forEach(([key, value]) => {
              if (value !== null && value !== '') {
                console.log(`  ${key}: ${JSON.stringify(value)}`);
              }
            });
          });
        }
      } catch (err) {
        console.log('Erro ao contar registros:', err.message);
      }
    }
    
    // 3. Analisar relacionamentos
    console.log('\n\n🔗 RELACIONAMENTOS (Foreign Keys):\n');
    const [relations] = await sequelize.query(`
      SELECT
        tc.table_name, 
        kcu.column_name, 
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name 
      FROM 
        information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' 
      AND tc.table_schema = 'maya-crm'
    `);
    
    relations.forEach(rel => {
      console.log(`  ${rel.table_name}.${rel.column_name} -> ${rel.foreign_table_name}.${rel.foreign_column_name}`);
    });
    
    // 4. Salvar estrutura em arquivo JSON
    const structure = {
      tables: tableStructures,
      relations: relations,
      analyzedAt: new Date().toISOString()
    };
    
    fs.writeFileSync('database-structure.json', JSON.stringify(structure, null, 2));
    console.log('\n\n✅ Estrutura salva em database-structure.json');
    
    // 5. Queries úteis para o dashboard
    console.log('\n\n📊 ANÁLISE PARA O DASHBOARD:\n');
    
    // Contatos/Leads
    const [[leadStats]] = await sequelize.query(`
      SELECT 
        COUNT(*) as total_contatos,
        COUNT(CASE WHEN criado_em >= CURRENT_DATE THEN 1 END) as novos_hoje,
        COUNT(CASE WHEN criado_em >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as novos_semana
      FROM "maya-crm".contatos
    `);
    console.log('📈 Estatísticas de Contatos/Leads:', leadStats);
    
    // Pipeline
    const [pipelineStages] = await sequelize.query(`
      SELECT 
        pe.nome as etapa,
        pe.ordem,
        COUNT(n.id) as total_negocios,
        COALESCE(SUM(n.valor), 0) as valor_total
      FROM "maya-crm".pipeline_etapas pe
      LEFT JOIN "maya-crm".negocios n ON n.etapa_id = pe.id
      WHERE pe.ativo = true
      GROUP BY pe.id, pe.nome, pe.ordem
      ORDER BY pe.ordem
    `);
    console.log('\n📊 Pipeline de Vendas:');
    pipelineStages.forEach(stage => {
      console.log(`  - ${stage.etapa}: ${stage.total_negocios} negócios (R$ ${stage.valor_total})`);
    });
    
    // Conversas/Mensagens
    const [[messageStats]] = await sequelize.query(`
      SELECT 
        COUNT(DISTINCT c.id) as total_conversas,
        COUNT(DISTINCT CASE WHEN c.status = 'aberta' THEN c.id END) as conversas_abertas,
        COUNT(m.id) as total_mensagens
      FROM "maya-crm".conversas c
      LEFT JOIN "maya-crm".mensagens m ON m.conversa_id = c.id
    `);
    console.log('\n💬 Estatísticas de Mensagens:', messageStats);
    
    // Canais
    const [channelStats] = await sequelize.query(`
      SELECT 
        canal,
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'aberta' THEN 1 END) as abertas
      FROM "maya-crm".conversas
      GROUP BY canal
    `);
    console.log('\n📱 Distribuição por Canal:');
    channelStats.forEach(ch => {
      console.log(`  - ${ch.canal}: ${ch.total} conversas (${ch.abertas} abertas)`);
    });
    
    await sequelize.close();
    console.log('\n✅ Análise concluída!');
    
  } catch (error) {
    console.error('❌ Erro:', error);
  }
}

analyzeDatabase();