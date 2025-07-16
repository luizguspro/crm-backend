// check-env.js
// Execute na pasta backend: node check-env.js

const fs = require('fs');
const path = require('path');

console.log('🔍 Verificando configuração de ambiente...\n');

// 1. Verificar se existe .env
const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, '..', '.env.example');

if (!fs.existsSync(envPath)) {
  console.log('❌ Arquivo .env não encontrado!');
  
  // Criar .env baseado no .env.example
  if (fs.existsSync(envExamplePath)) {
    console.log('📋 Copiando .env.example...');
    fs.copyFileSync(envExamplePath, envPath);
    console.log('✅ .env criado a partir do .env.example');
  } else {
    console.log('📝 Criando .env padrão...');
    
    const envContent = `# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vico_crm
DB_HOST=localhost
DB_PORT=5432
DB_NAME=vico_crm
DB_USER=postgres
DB_PASS=postgres

# JWT
JWT_SECRET=your-secret-key-here-change-this-in-production
JWT_EXPIRE=7d

# Environment
NODE_ENV=development
PORT=3001

# Frontend URL
FRONTEND_URL=http://localhost:5173
`;
    
    fs.writeFileSync(envPath, envContent);
    console.log('✅ .env criado com configurações padrão');
  }
}

// 2. Ler e verificar .env
console.log('\n📋 Verificando variáveis de ambiente:');
require('dotenv').config();

const requiredVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'PORT'
];

const missingVars = [];
requiredVars.forEach(varName => {
  if (process.env[varName]) {
    console.log(`✅ ${varName}: ${varName === 'DATABASE_URL' ? process.env[varName].replace(/:[^:]*@/, ':****@') : '***'}`);
  } else {
    console.log(`❌ ${varName}: NÃO DEFINIDO`);
    missingVars.push(varName);
  }
});

// 3. Criar script de teste melhorado
console.log('\n📝 Criando script de teste melhorado...');

const testUserImprovedContent = `// backend/test-user-db.js
// Script melhorado para criar usuário de teste
// Execute: node test-user-db.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const bcrypt = require('bcryptjs');
const { Sequelize } = require('sequelize');

// Verificar se DATABASE_URL está definido
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL não está definido no .env');
  console.log('Por favor, configure o arquivo .env com:');
  console.log('DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vico_crm');
  process.exit(1);
}

console.log('🔗 Conectando ao banco:', process.env.DATABASE_URL.replace(/:[^:]*@/, ':****@'));

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  logging: false,
  dialectOptions: {
    ssl: false
  }
});

async function createTestUser() {
  try {
    console.log('\\n🔍 Verificando conexão com banco...');
    await sequelize.authenticate();
    console.log('✅ Conectado ao banco de dados');

    // Verificar se a tabela usuarios existe
    const [tables] = await sequelize.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'usuarios'"
    );
    
    if (tables.length === 0) {
      console.log('\\n❌ Tabela usuarios não encontrada!');
      console.log('Execute primeiro: npm run setup:db');
      await sequelize.close();
      return;
    }

    // Verificar se usuário já existe
    const [existing] = await sequelize.query(
      'SELECT id, email, nome FROM usuarios WHERE email = :email',
      {
        replacements: { email: 'admin@mayacrm.com' },
        type: Sequelize.QueryTypes.SELECT
      }
    );

    if (existing) {
      console.log('\\nℹ️  Usuário já existe:');
      console.log('   ID:', existing.id);
      console.log('   Nome:', existing.nome);
      console.log('   Email:', existing.email);
      
      // Atualizar senha
      const hashedPassword = await bcrypt.hash('123456', 10);
      await sequelize.query(
        'UPDATE usuarios SET senha = :senha, atualizado_em = NOW() WHERE id = :id',
        {
          replacements: { 
            senha: hashedPassword,
            id: existing.id 
          }
        }
      );
      console.log('\\n✅ Senha atualizada para: 123456');
    } else {
      // Criar novo usuário
      console.log('\\n📝 Criando novo usuário...');
      const hashedPassword = await bcrypt.hash('123456', 10);
      
      const [result] = await sequelize.query(
        \`INSERT INTO usuarios (nome, email, senha, tipo, ativo, criado_em, atualizado_em) 
         VALUES (:nome, :email, :senha, 'admin', true, NOW(), NOW())
         RETURNING id, nome, email\`,
        {
          replacements: {
            nome: 'Admin Maya',
            email: 'admin@mayacrm.com',
            senha: hashedPassword
          }
        }
      );
      
      console.log('\\n✅ Usuário criado com sucesso:');
      console.log('   ID:', result[0].id);
      console.log('   Nome:', result[0].nome);
      console.log('   Email:', result[0].email);
      console.log('   Senha: 123456');
      console.log('   Tipo: admin');
    }

    console.log('\\n🎉 Pronto! Você pode fazer login com:');
    console.log('   Email: admin@mayacrm.com');
    console.log('   Senha: 123456');

    await sequelize.close();
    
  } catch (error) {
    console.error('\\n❌ Erro:', error.message);
    if (error.original) {
      console.error('Detalhes:', error.original.message);
    }
    process.exit(1);
  }
}

createTestUser();
`;

fs.writeFileSync('test-user-db.js', testUserImprovedContent);
console.log('✅ test-user-db.js criado');

// 4. Mostrar próximos passos
console.log('\n' + '='.repeat(50));
console.log('📋 PRÓXIMOS PASSOS:');
console.log('='.repeat(50));

if (missingVars.length > 0) {
  console.log('\n1. Configure as variáveis faltantes no arquivo .env');
  console.log('   Abra o arquivo .env e configure:');
  missingVars.forEach(v => {
    if (v === 'DATABASE_URL') {
      console.log(`   ${v}=postgresql://postgres:SUA_SENHA@localhost:5432/vico_crm`);
    } else if (v === 'JWT_SECRET') {
      console.log(`   ${v}=uma-chave-secreta-muito-segura`);
    }
  });
}

console.log('\n2. Execute o novo script de teste:');
console.log('   node test-user-db.js');

console.log('\n3. Reinicie o servidor:');
console.log('   npm run dev');

console.log('\n4. Teste o login em: http://localhost:3001/api/auth/login');
console.log('   ou http://localhost:5173 (frontend)');

// 5. Verificar se o PostgreSQL está rodando
console.log('\n🐘 Verificando PostgreSQL...');
const { exec } = require('child_process');

exec('pg_isready', (error, stdout, stderr) => {
  if (error) {
    console.log('⚠️  PostgreSQL pode não estar rodando');
    console.log('   Inicie com: net start postgresql-x64-14 (ou sua versão)');
  } else {
    console.log('✅ PostgreSQL está rodando');
  }
});