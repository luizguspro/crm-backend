// backend/src/scripts/verifyUser.js
require('dotenv').config({ path: '../../.env' });
const { sequelize } = require('../../../shared/database');
const bcrypt = require('bcryptjs');

async function verifyUser() {
  try {
    console.log('🔍 Verificando usuário no banco...\n');
    
    // Buscar usuário diretamente via SQL
    const [users] = await sequelize.query(`
      SELECT id, nome, email, senha, tipo, ativo, empresa_id
      FROM "maya-crm".usuarios 
      WHERE email = 'admin@mayacrm.com'
    `);
    
    if (users.length === 0) {
      console.log('❌ Usuário não encontrado!');
      return;
    }
    
    const user = users[0];
    console.log('✅ Usuário encontrado:');
    console.log(`   ID: ${user.id}`);
    console.log(`   Nome: ${user.nome}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Tipo: ${user.tipo || 'NÃO DEFINIDO'}`);
    console.log(`   Ativo: ${user.ativo}`);
    console.log(`   Empresa ID: ${user.empresa_id}`);
    console.log(`   Hash da senha: ${user.senha.substring(0, 20)}...`);
    
    // Testar senha
    console.log('\n🔐 Testando senhas:');
    const senhas = ['123456', 'admin123', 'password'];
    
    for (const senha of senhas) {
      const match = await bcrypt.compare(senha, user.senha);
      console.log(`   ${senha}: ${match ? '✅ CORRETA' : '❌ incorreta'}`);
    }
    
  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await sequelize.close();
  }
}

verifyUser();