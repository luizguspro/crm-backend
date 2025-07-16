// debug-auth.js
// Execute na pasta backend: node debug-auth.js

const fs = require('fs');
const path = require('path');

console.log('🔍 Adicionando debug na rota de autenticação...\n');

const authDebugContent = `// backend/src/routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Sequelize } = require('sequelize');

// Configurar Sequelize com schema
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  logging: console.log, // ATIVAR LOGS TEMPORARIAMENTE
  dialectOptions: {
    ssl: process.env.NODE_ENV === 'production' ? {
      require: true,
      rejectUnauthorized: false
    } : false
  },
  define: {
    schema: 'maya-crm'
  }
});

// Função para gerar JWT
function generateToken(user) {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email,
      nome: user.nome,
      tipo: user.tipo 
    },
    process.env.JWT_SECRET || 'maya-crm-secret-key',
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    console.log('\\n=== DEBUG LOGIN ===');
    console.log('Headers:', req.headers);
    console.log('Body recebido:', req.body);
    console.log('Content-Type:', req.headers['content-type']);
    
    const { email, password } = req.body;
    
    console.log('Email extraído:', email);
    console.log('Password existe?', !!password);

    // Validar entrada
    if (!email || !password) {
      console.log('❌ Email ou senha faltando');
      return res.status(400).json({ 
        error: 'Email e senha são obrigatórios',
        received: { email: !!email, password: !!password }
      });
    }

    console.log('✅ Validação passou, buscando usuário...');

    // Definir schema
    await sequelize.query('SET search_path TO "maya-crm", public');

    // Buscar usuário no banco
    const query = 'SELECT * FROM "maya-crm".usuarios WHERE email = :email AND ativo = true';
    console.log('Query:', query);
    console.log('Email buscado:', email);
    
    const [results] = await sequelize.query(query, {
      replacements: { email },
      type: Sequelize.QueryTypes.SELECT
    });

    console.log('Resultados encontrados:', results.length);

    if (!results || results.length === 0) {
      console.log('❌ Usuário não encontrado:', email);
      return res.status(401).json({ 
        error: 'Email ou senha inválidos' 
      });
    }

    const user = results[0];
    console.log('✅ Usuário encontrado:', user.email);

    // Verificar senha
    console.log('Verificando senha...');
    const validPassword = await bcrypt.compare(password, user.senha);
    console.log('Senha válida?', validPassword);
    
    if (!validPassword) {
      console.log('❌ Senha inválida para:', email);
      return res.status(401).json({ 
        error: 'Email ou senha inválidos' 
      });
    }

    // Gerar token
    const token = generateToken(user);
    console.log('✅ Token gerado');

    // Atualizar último acesso
    await sequelize.query(
      'UPDATE "maya-crm".usuarios SET ultimo_acesso = NOW() WHERE id = :id',
      {
        replacements: { id: user.id },
        type: Sequelize.QueryTypes.UPDATE
      }
    );

    console.log('✅ Login bem-sucedido:', email);
    console.log('=== FIM DEBUG LOGIN ===\\n');

    // Responder com sucesso
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        tipo: user.tipo,
        empresa_id: user.empresa_id
      }
    });

  } catch (error) {
    console.error('\\n❌ ERRO NO LOGIN:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ 
      error: 'Erro ao fazer login',
      message: error.message,
      details: error.stack
    });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { nome, email, password, empresa } = req.body;

    // Validar entrada
    if (!nome || !email || !password) {
      return res.status(400).json({ 
        error: 'Nome, email e senha são obrigatórios' 
      });
    }

    // Definir schema
    await sequelize.query('SET search_path TO "maya-crm", public');

    // Verificar se usuário já existe
    const [existing] = await sequelize.query(
      'SELECT id FROM "maya-crm".usuarios WHERE email = :email',
      {
        replacements: { email },
        type: Sequelize.QueryTypes.SELECT
      }
    );

    if (existing && existing.length > 0) {
      return res.status(400).json({ 
        error: 'Email já cadastrado' 
      });
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(password, 10);

    // Criar usuário
    const [result] = await sequelize.query(
      \`INSERT INTO "maya-crm".usuarios (nome, email, senha, tipo, ativo) 
       VALUES (:nome, :email, :senha, 'admin', true) 
       RETURNING *\`,
      {
        replacements: { 
          nome, 
          email, 
          senha: hashedPassword 
        },
        type: Sequelize.QueryTypes.INSERT
      }
    );

    const newUser = result[0];

    // Gerar token
    const token = generateToken(newUser);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: newUser.id,
        nome: newUser.nome,
        email: newUser.email,
        tipo: newUser.tipo
      }
    });

  } catch (error) {
    console.error('Erro no registro:', error);
    res.status(500).json({ 
      error: 'Erro ao criar conta',
      message: error.message 
    });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Logout realizado com sucesso' 
  });
});

// GET /api/auth/verify
router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ 
        error: 'Token não fornecido' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'maya-crm-secret-key');
    
    res.json({ 
      valid: true, 
      user: decoded 
    });

  } catch (error) {
    res.status(401).json({ 
      valid: false, 
      error: 'Token inválido' 
    });
  }
});

module.exports = router;
`;

fs.writeFileSync('src/routes/auth.js', authDebugContent);
console.log('✅ Debug adicionado em src/routes/auth.js');

// Criar teste manual via curl
console.log('\n📝 Criando script de teste manual...');

const testLoginContent = `// test-login.js
// Teste manual de login
// Execute: node test-login.js

const axios = require('axios');

async function testLogin() {
  try {
    console.log('🔍 Testando login...');
    
    const response = await axios.post('http://localhost:3001/api/auth/login', {
      email: 'admin@mayacrm.com',
      password: '123456'
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Login bem-sucedido!');
    console.log('Response:', response.data);
    
  } catch (error) {
    console.error('❌ Erro no login:');
    console.error('Status:', error.response?.status);
    console.error('Data:', error.response?.data);
    console.error('Headers:', error.response?.headers);
  }
}

testLogin();
`;

fs.writeFileSync('test-login.js', testLoginContent);
console.log('✅ test-login.js criado');

// Instalar axios se não tiver
console.log('\n📦 Verificando dependências...');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

if (!packageJson.dependencies.axios) {
  console.log('⚠️  Axios não encontrado. Execute: npm install axios');
}

console.log('\n' + '='.repeat(50));
console.log('🔍 DEBUG ATIVADO!');
console.log('='.repeat(50));

console.log('\nAgora:');
console.log('\n1. Reinicie o servidor:');
console.log('   Ctrl+C e depois npm run dev');
console.log('\n2. Tente fazer login novamente no navegador');
console.log('\n3. Observe os logs detalhados no console do servidor');
console.log('\n4. Ou teste via script:');
console.log('   npm install axios (se não tiver)');
console.log('   node test-login.js');
console.log('\nOs logs vão mostrar exatamente o que está acontecendo!');