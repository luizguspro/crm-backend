// backend/src/middleware/auth.js
const jwt = require('jsonwebtoken');
const { Sequelize } = require('sequelize');

// Configurar Sequelize
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  logging: false
});

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ 
        error: 'Token não fornecido' 
      });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'maya-crm-secret-key');
    
    // Pegar empresa_id do token primeiro
    let empresaId = decoded.empresa_id || process.env.DEFAULT_EMPRESA_ID || '00000000-0000-0000-0000-000000000001';
    
    // Buscar dados completos do usuário
    const [users] = await sequelize.query(
      'SELECT id, nome, email, empresa_id, tipo FROM "maya-crm".usuarios WHERE id = :id',
      {
        replacements: { id: decoded.id }
      }
    );
    
    const user = users[0];
    
    if (user) {
      // Se o usuário foi encontrado, usar empresa_id dele se existir
      if (user.empresa_id) {
        empresaId = user.empresa_id;
      }
      req.user = user;
    } else {
      // Se não encontrou o usuário, criar um objeto básico
      req.user = {
        id: decoded.id,
        email: decoded.email,
        nome: decoded.nome,
        tipo: decoded.tipo,
        empresa_id: empresaId
      };
    }
    
    // Adicionar informações ao request
    req.userId = decoded.id;
    req.empresaId = empresaId;
    
    console.log('Auth Middleware - empresaId:', req.empresaId);
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Token inválido' 
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expirado' 
      });
    }
    
    console.error('Erro no middleware de autenticação:', error);
    return res.status(500).json({ 
      error: 'Erro ao processar autenticação' 
    });
  }
};

module.exports = authMiddleware;