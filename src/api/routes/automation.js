// backend/src/api/routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Usuario } = require('../../../../shared/models');
const logger = require('../../../../shared/utils/logger');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    console.log('\n=== DEBUG LOGIN ===');
    console.log('Body completo:', JSON.stringify(req.body));
    console.log('Headers:', req.headers);
    
    const { email, senha } = req.body;
    const password = senha; // Para manter compatibilidade com o resto do código
    
    console.log('Email extraído:', email);
    console.log('Password extraído:', password);
    console.log('Tipo do email:', typeof email);
    console.log('Tipo do password:', typeof password);
    console.log('===================\n');
    
    logger.info(`Tentativa de login: ${email}`);

    // Validar entrada
    if (!email || !password) {
      console.log('ERRO: Campos obrigatórios faltando!');
      console.log('Email presente?', !!email);
      console.log('Password presente?', !!password);
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    // Buscar usuário
    console.log('Buscando usuário no banco...');
    const usuario = await Usuario.findOne({
      where: { 
        email: email.toLowerCase(),
        ativo: true 
      }
    });

    if (!usuario) {
      console.log('Usuário não encontrado para email:', email);
      logger.warn(`Usuário não encontrado: ${email}`);
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    console.log('Usuário encontrado:', {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      tipo: usuario.tipo,
      ativo: usuario.ativo
    });

    // Verificar senha
    console.log('Verificando senha...');
    const senhaValida = await bcrypt.compare(password, usuario.senha);
    console.log('Senha válida?', senhaValida);
    
    if (!senhaValida) {
      console.log('Senha inválida para usuário:', email);
      logger.warn(`Senha inválida para: ${email}`);
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    // Gerar token
    console.log('Gerando token JWT...');
    const token = jwt.sign(
      { 
        id: usuario.id, 
        email: usuario.email,
        empresa_id: usuario.empresa_id,
        tipo: usuario.tipo
      },
      process.env.JWT_SECRET || 'maya_crm_secret_key_2024',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Atualizar último acesso
    await usuario.update({ ultimo_acesso: new Date() });

    console.log('Login bem-sucedido! Retornando resposta...');
    logger.info(`Login bem-sucedido: ${email}`);

    // Resposta de sucesso
    const response = {
      success: true,
      token,
      user: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        cargo: usuario.cargo,
        tipo: usuario.tipo,
        empresa_id: usuario.empresa_id
      }
    };

    console.log('Resposta a ser enviada:', response);
    res.json(response);

  } catch (error) {
    console.error('ERRO NO LOGIN:', error);
    logger.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro ao realizar login' });
  }
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  try {
    // Verificar token
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }

    const decoded = jwt.verify(
      token, 
      process.env.JWT_SECRET || 'maya_crm_secret_key_2024'
    );
    
    // Buscar usuário
    const usuario = await Usuario.findByPk(decoded.id, {
      attributes: ['id', 'nome', 'email', 'cargo', 'tipo', 'empresa_id']
    });

    if (!usuario) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json({ user: usuario });

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token inválido' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado' });
    }
    
    logger.error('Erro ao buscar usuário:', error);
    res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { nome, email, senha, telefone, empresa_nome } = req.body;
    
    // Validar entrada
    if (!nome || !email || !senha) {
      return res.status(400).json({ 
        error: 'Nome, email e senha são obrigatórios' 
      });
    }
    
    // Verificar se usuário já existe
    const usuarioExiste = await Usuario.findOne({
      where: { email: email.toLowerCase() }
    });
    
    if (usuarioExiste) {
      return res.status(400).json({ 
        error: 'Email já cadastrado' 
      });
    }
    
    // Hash da senha
    const hashedPassword = await bcrypt.hash(senha, 10);
    
    // Usar empresa padrão por enquanto
    const empresaId = process.env.DEFAULT_EMPRESA_ID || '00000000-0000-0000-0000-000000000001';
    
    // Criar usuário
    const novoUsuario = await Usuario.create({
      nome,
      email: email.toLowerCase(),
      senha: hashedPassword,
      telefone,
      empresa_id: empresaId,
      tipo: 'usuario',
      ativo: true
    });
    
    // Gerar token
    const token = jwt.sign(
      { 
        id: novoUsuario.id, 
        email: novoUsuario.email,
        empresa_id: novoUsuario.empresa_id 
      },
      process.env.JWT_SECRET || 'maya_crm_secret_key_2024',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    
    logger.info(`Novo usuário registrado: ${email}`);
    
    res.status(201).json({
      success: true,
      token,
      user: {
        id: novoUsuario.id,
        nome: novoUsuario.nome,
        email: novoUsuario.email,
        empresa_id: novoUsuario.empresa_id
      }
    });
    
  } catch (error) {
    logger.error('Erro no registro:', error);
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Logout realizado com sucesso' });
});

// GET /api/auth/test - Rota de teste
router.get('/test', (req, res) => {
  res.json({ 
    message: 'Auth route is working!',
    timestamp: new Date()
  });
});

module.exports = router;