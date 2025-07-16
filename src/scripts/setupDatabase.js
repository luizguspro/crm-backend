// backend/src/scripts/setupDatabase.js
const { Client } = require('pg');

async function setupDatabase() {
  // Primeiro conecta ao banco postgres padrão
  const client = new Client({
    host: 'localhost',
    user: 'postgres',
    password: '32494565',
    database: 'postgres' // Conecta ao banco padrão primeiro
  });

  try {
    await client.connect();
    console.log('✅ Conectado ao PostgreSQL');

    // Verificar se o banco maya-crm existe
    const checkDbQuery = `
      SELECT datname FROM pg_database WHERE datname = 'maya-crm';
    `;
    
    const result = await client.query(checkDbQuery);
    
    if (result.rows.length === 0) {
      console.log('⚠️  Banco maya-crm não encontrado. Criando...');
      
      // Criar o banco
      await client.query('CREATE DATABASE "maya-crm"');
      console.log('✅ Banco maya-crm criado com sucesso!');
    } else {
      console.log('✅ Banco maya-crm já existe');
    }

    // Listar todos os bancos para confirmação
    const listDbsQuery = `
      SELECT datname FROM pg_database 
      WHERE datistemplate = false
      ORDER BY datname;
    `;
    
    const dbs = await client.query(listDbsQuery);
    console.log('\n📊 Bancos de dados disponíveis:');
    dbs.rows.forEach(row => {
      console.log(`   - ${row.datname}`);
    });

  } catch (error) {
    console.error('❌ Erro:', error.message);
    
    // Se o erro for de encoding, tenta criar sem especificar encoding
    if (error.message.includes('encoding')) {
      try {
        await client.query(`CREATE DATABASE "maya-crm"`);
        console.log('✅ Banco criado sem encoding específico');
      } catch (e) {
        console.error('❌ Erro ao criar banco:', e.message);
      }
    }
  } finally {
    await client.end();
  }
}

// Executar
setupDatabase().then(() => {
  console.log('\n🎯 Setup concluído!');
  process.exit(0);
}).catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});