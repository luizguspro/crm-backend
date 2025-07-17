// backend/src/routes/auth.js - Atualizar a parte do login
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
      tipo: user.tipo,
      empresa_id: user.empresa_id // IMPORTANTE: incluir empresa_id no token
    },
    process.env.JWT_SECRET || 'maya-crm-secret-key',
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    console.log('Tentativa de login:', req.body.email);
    
    const { email } = req.body;
    const password = req.body.password || req.body.senha;
    
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email e senha são obrigatórios' 
      });
    }

    // Buscar usuário no banco
    const [users] = await sequelize.query(
      'SELECT * FROM "maya-crm".usuarios WHERE email = :email AND ativo = true',
      {
        replacements: { email },
        type: Sequelize.QueryTypes.SELECT,
        raw: true
      }
    );

    const user = users;

    if (!user) {
      console.log('Usuário não encontrado:', email);
      return res.status(401).json({ 
        error: 'Email ou senha inválidos' 
      });
    }

    console.log('Usuário encontrado:', {
      id: user.id,
      email: user.email,
      empresa_id: user.empresa_id
    });

    // Verificar senha
    const validPassword = await bcrypt.compare(password, user.senha);
    
    if (!validPassword) {
      console.log('Senha inválida para:', email);
      return res.status(401).json({ 
        error: 'Email ou senha inválidos' 
      });
    }

    // Garantir que o usuário tem empresa_id
    if (!user.empresa_id) {
      user.empresa_id = process.env.DEFAULT_EMPRESA_ID || '00000000-0000-0000-0000-000000000001';
      console.log('Usuário sem empresa_id, usando padrão:', user.empresa_id);
    }

    // Gerar token
    const token = generateToken(user);

    // Atualizar último acesso
    await sequelize.query(
      'UPDATE "maya-crm".usuarios SET ultimo_acesso = NOW() WHERE id = :id',
      { replacements: { id: user.id } }
    );

    console.log('Login bem-sucedido!');
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
    console.error('Erro no login:', error);
    res.status(500).json({ 
      error: 'Erro ao fazer login' 
    });
  }
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'maya-crm-secret-key');
    
    // Buscar usuário atualizado
    const [users] = await sequelize.query(
      'SELECT id, nome, email, tipo, empresa_id FROM "maya-crm".usuarios WHERE id = :id',
      {
        replacements: { id: decoded.id }
      }
    );

    const user = users[0];

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // Garantir empresa_id
    if (!user.empresa_id) {
      user.empresa_id = process.env.DEFAULT_EMPRESA_ID || '00000000-0000-0000-0000-000000000001';
    }

    res.json({ 
      user: {
        ...user,
        empresa_id: user.empresa_id
      }
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token inválido' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado' });
    }
    
    console.error('Erro ao buscar usuário:', error);
    res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
});

// POST /api/auth/verify
router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'maya-crm-secret-key');
    
    res.json({ 
      valid: true,
      userId: decoded.id,
      empresaId: decoded.empresa_id || process.env.DEFAULT_EMPRESA_ID
    });

  } catch (error) {
    res.status(401).json({ 
      valid: false,
      error: 'Token inválido' 
    });
  }
});

module.exports = router;