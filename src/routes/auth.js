// backend/src/routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Sequelize } = require('sequelize');

// Configurar Sequelize com schema
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  logging: false,
  dialectOptions: {
    ssl: process.env.NODE_ENV === 'production' ? {
      require: true,
      rejectUnauthorized: false
    } : false
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
    console.log('Tentativa de login:', req.body.email);
    
    // Aceitar tanto 'password' quanto 'senha'
    const { email } = req.body;
    const password = req.body.password || req.body.senha;
    
    // Validar entrada
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email e senha são obrigatórios' 
      });
    }

    // Buscar usuário no banco - QUERY CORRIGIDA
    const [users] = await sequelize.query(
      'SELECT * FROM "maya-crm".usuarios WHERE email = :email AND ativo = true',
      {
        replacements: { email },
        type: Sequelize.QueryTypes.SELECT,
        raw: true
      }
    );

    // O resultado já vem como array direto
    const user = users;

    if (!user) {
      console.log('Usuário não encontrado:', email);
      return res.status(401).json({ 
        error: 'Email ou senha inválidos' 
      });
    }

    // Verificar senha
    const validPassword = await bcrypt.compare(password, user.senha);
    
    if (!validPassword) {
      console.log('Senha inválida para:', email);
      return res.status(401).json({ 
        error: 'Email ou senha inválidos' 
      });
    }

    // Gerar token
    const token = generateToken(user);

    // Atualizar último acesso
    await sequelize.query(
      'UPDATE "maya-crm".usuarios SET ultimo_acesso = NOW() WHERE id = :id',
      {
        replacements: { id: user.id },
        type: Sequelize.QueryTypes.UPDATE
      }
    );

    console.log('Login bem-sucedido:', email);

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
    console.error('Erro no login:', error.message);
    res.status(500).json({ 
      error: 'Erro ao fazer login',
      message: error.message 
    });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { nome, email } = req.body;
    const password = req.body.password || req.body.senha;

    // Validar entrada
    if (!nome || !email || !password) {
      return res.status(400).json({ 
        error: 'Nome, email e senha são obrigatórios' 
      });
    }

    // Verificar se usuário já existe
    const [existing] = await sequelize.query(
      'SELECT id FROM "maya-crm".usuarios WHERE email = :email',
      {
        replacements: { email },
        type: Sequelize.QueryTypes.SELECT
      }
    );

    if (existing) {
      return res.status(400).json({ 
        error: 'Email já cadastrado' 
      });
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(password, 10);

    // Criar usuário - ID gerado pelo banco
    const [result] = await sequelize.query(
      `INSERT INTO "maya-crm".usuarios 
       (id, nome, email, senha, tipo, ativo, empresa_id, criado_em, atualizado_em) 
       VALUES 
       (gen_random_uuid(), :nome, :email, :senha, 'admin', true, '00000000-0000-0000-0000-000000000001', NOW(), NOW()) 
       RETURNING *`,
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
    
    // Verificar se o usuário ainda existe e está ativo
    const [user] = await sequelize.query(
      'SELECT id, nome, email, tipo FROM "maya-crm".usuarios WHERE id = :id AND ativo = true',
      {
        replacements: { id: decoded.id },
        type: Sequelize.QueryTypes.SELECT
      }
    );

    if (!user) {
      return res.status(401).json({ 
        valid: false, 
        error: 'Usuário não encontrado ou inativo' 
      });
    }
    
    res.json({ 
      valid: true, 
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        tipo: user.tipo
      }
    });

  } catch (error) {
    res.status(401).json({ 
      valid: false, 
      error: 'Token inválido' 
    });
  }
});

// GET /api/auth/me - Obter dados do usuário atual
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ 
        error: 'Token não fornecido' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'maya-crm-secret-key');
    
    const [user] = await sequelize.query(
      'SELECT id, nome, email, tipo, empresa_id, telefone, cargo FROM "maya-crm".usuarios WHERE id = :id',
      {
        replacements: { id: decoded.id },
        type: Sequelize.QueryTypes.SELECT
      }
    );

    if (!user) {
      return res.status(404).json({ 
        error: 'Usuário não encontrado' 
      });
    }
    
    res.json({ 
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        tipo: user.tipo,
        empresa_id: user.empresa_id,
        telefone: user.telefone,
        cargo: user.cargo
      }
    });

  } catch (error) {
    res.status(401).json({ 
      error: 'Token inválido' 
    });
  }
});

module.exports = router;
