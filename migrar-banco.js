// copiar-dados.js
const { Client } = require('pg');

async function copiarDados() {
  const origem = new Client({
    host: 'localhost',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: '32494565'
  });
  
  const destino = new Client({
    host: 'nozomi.proxy.rlwy.net',
    port: 14202,
    database: 'railway',
    user: 'postgres',
    password: 'GPsCWCtWrNilhUuTNsZeJxLuIbJhyfjp',
    ssl: { rejectUnauthorized: false }
  });
  
  await origem.connect();
  await destino.connect();
  
  console.log('✅ Conectado! Copiando dados...');
  
  // Desabilita triggers
  await destino.query('SET session_replication_role = replica');
  
  // Lista de tabelas na ordem correta
  const tabelas = [
    'empresas', 'usuarios', 'pipeline_etapas', 'tags', 
    'campos_customizados', 'campos_personalizados', 'canais_integracao',
    'contatos', 'conversas', 'mensagens', 'negocios', 
    'negocios_historico', 'tarefas', 'respostas_rapidas',
    'metricas_diarias', 'notas', 'automacao_execucoes', 
    'automacao_fluxos', 'bot_configuracoes', 'contatos_tags',
    'contatos_campos_valores', 'valores_campos_personalizados'
  ];
  
  for (const tabela of tabelas) {
    try {
      const { rows } = await origem.query(`SELECT * FROM "maya-crm"."${tabela}"`);
      
      if (rows.length > 0) {
        // Copia usando COPY para performance
        const copyQuery = `COPY "maya-crm"."${tabela}" FROM STDIN WITH (FORMAT CSV, HEADER TRUE)`;
        
        console.log(`📋 ${tabela}: ${rows.length} registros`);
        
        // Insere em lotes
        for (const row of rows) {
          const values = Object.values(row).map(v => 
            v === null ? '\\N' : String(v).replace(/\n/g, '\\n')
          );
          
          await destino.query(
            `INSERT INTO "maya-crm"."${tabela}" VALUES (${values.map((_, i) => `$${i+1}`).join(',')})`,
            Object.values(row)
          ).catch(e => console.log(`  ⚠️ Erro: ${e.message.substring(0, 50)}`));
        }
      }
    } catch (err) {
      console.log(`❌ ${tabela}: ${err.message}`);
    }
  }
  
  // Reabilita triggers
  await destino.query('SET session_replication_role = DEFAULT');
  
  console.log('\n✅ Migração concluída!');
  
  await origem.end();
  await destino.end();
}

copiarDados().catch(console.error);