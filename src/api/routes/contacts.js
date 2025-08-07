// backend/src/api/routes/contacts.js
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const { 
  Contato,
  Tag,
  Negocio,
  Conversa
} = require('../../../../shared/models');
const logger = require('../../../../shared/utils/logger');

// Configurar multer para upload de arquivos
const upload = multer({ 
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max
  }
});

// Middleware temporário para empresa padrão
const setDefaultEmpresa = (req, res, next) => {
  req.empresaId = process.env.DEFAULT_EMPRESA_ID || '00000000-0000-0000-0000-000000000001';
  next();
};

router.use(setDefaultEmpresa);

// GET /api/contacts - Listar todos os contatos
router.get('/', async (req, res) => {
  try {
    const { search, tags, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = {
      empresa_id: req.empresaId,
      ativo: true
    };

    // Busca por nome, email, telefone ou empresa
    if (search) {
      whereClause[Op.or] = [
        { nome: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
        { whatsapp: { [Op.like]: `%${search}%` } },
        { empresa: { [Op.like]: `%${search}%` } }
      ];
    }

    const { count, rows: contatos } = await Contato.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['criado_em', 'DESC']]
    });

    // Buscar informações adicionais para cada contato
    const contatosCompletos = await Promise.all(
      contatos.map(async (contato) => {
        // Buscar última conversa
        const ultimaConversa = await Conversa.findOne({
          where: { contato_id: contato.id },
          order: [['ultima_mensagem_em', 'DESC']]
        });

        // Buscar negócios
        const negocios = await Negocio.findAll({
          where: { 
            contato_id: contato.id,
            ganho: null 
          }
        });

        const valorTotal = negocios.reduce((sum, neg) => sum + (parseFloat(neg.valor) || 0), 0);

        // Tags temporárias (simplificado)
        const tags = [];
        if (contato.score >= 70) tags.push('Quente');
        if (valorTotal > 50000) tags.push('Alto Valor');
        if (contato.origem) tags.push(contato.origem);

        return {
          id: contato.id,
          nome: contato.nome,
          email: contato.email,
          telefone: contato.telefone,
          whatsapp: contato.whatsapp,
          cpf_cnpj: contato.cpf_cnpj,
          empresa: contato.empresa,
          cargo: contato.cargo,
          score: contato.score,
          tags: tags,
          ultimoContato: ultimaConversa?.ultima_mensagem_em 
            ? formatRelativeTime(ultimaConversa.ultima_mensagem_em)
            : 'Sem contato',
          valorTotal: valorTotal,
          origem: contato.origem,
          criado_em: contato.criado_em
        };
      })
    );

    res.json({
      success: true,
      total: count,
      contatos: contatosCompletos,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit)
    });

  } catch (error) {
    console.error('Erro ao buscar contatos:', error);
    res.status(500).json({ error: 'Erro ao buscar contatos' });
  }
});

// GET /api/contacts/:id - Buscar contato específico
router.get('/:id', async (req, res) => {
  try {
    const contato = await Contato.findOne({
      where: {
        id: req.params.id,
        empresa_id: req.empresaId
      }
    });

    if (!contato) {
      return res.status(404).json({ error: 'Contato não encontrado' });
    }

    // Buscar informações relacionadas
    const conversas = await Conversa.count({
      where: { contato_id: contato.id }
    });

    const negocios = await Negocio.findAll({
      where: { contato_id: contato.id }
    });

    res.json({
      success: true,
      contato: {
        ...contato.toJSON(),
        totalConversas: conversas,
        negocios: negocios
      }
    });

  } catch (error) {
    console.error('Erro ao buscar contato:', error);
    res.status(500).json({ error: 'Erro ao buscar contato' });
  }
});

// POST /api/contacts - Criar novo contato
router.post('/', async (req, res) => {
  try {
    const {
      nome,
      email,
      telefone,
      whatsapp,
      cpf_cnpj,
      empresa,
      cargo,
      data_nascimento,
      origem
    } = req.body;

    // Validações básicas
    if (!nome) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    // Verificar duplicatas
    if (email) {
      const existente = await Contato.findOne({
        where: {
          empresa_id: req.empresaId,
          email: email
        }
      });
      if (existente) {
        return res.status(400).json({ error: 'Email já cadastrado' });
      }
    }

    if (whatsapp) {
      const existente = await Contato.findOne({
        where: {
          empresa_id: req.empresaId,
          whatsapp: whatsapp
        }
      });
      if (existente) {
        return res.status(400).json({ error: 'WhatsApp já cadastrado' });
      }
    }

    const novoContato = await Contato.create({
      empresa_id: req.empresaId,
      nome,
      email,
      telefone: telefone || whatsapp,
      whatsapp: whatsapp || telefone,
      cpf_cnpj,
      empresa,
      cargo,
      data_nascimento,
      origem: origem || 'manual',
      score: 50,
      ativo: true
    });

    res.status(201).json({
      success: true,
      contato: novoContato
    });

  } catch (error) {
    console.error('Erro ao criar contato:', error);
    res.status(500).json({ error: 'Erro ao criar contato' });
  }
});

// PUT /api/contacts/:id - Atualizar contato
router.put('/:id', async (req, res) => {
  try {
    const contato = await Contato.findOne({
      where: {
        id: req.params.id,
        empresa_id: req.empresaId
      }
    });

    if (!contato) {
      return res.status(404).json({ error: 'Contato não encontrado' });
    }

    // Verificar duplicatas se email ou whatsapp mudaram
    if (req.body.email && req.body.email !== contato.email) {
      const existente = await Contato.findOne({
        where: {
          empresa_id: req.empresaId,
          email: req.body.email,
          id: { [Op.ne]: contato.id }
        }
      });
      if (existente) {
        return res.status(400).json({ error: 'Email já cadastrado em outro contato' });
      }
    }

    if (req.body.whatsapp && req.body.whatsapp !== contato.whatsapp) {
      const existente = await Contato.findOne({
        where: {
          empresa_id: req.empresaId,
          whatsapp: req.body.whatsapp,
          id: { [Op.ne]: contato.id }
        }
      });
      if (existente) {
        return res.status(400).json({ error: 'WhatsApp já cadastrado em outro contato' });
      }
    }

    await contato.update(req.body);

    res.json({
      success: true,
      contato
    });

  } catch (error) {
    console.error('Erro ao atualizar contato:', error);
    res.status(500).json({ error: 'Erro ao atualizar contato' });
  }
});

// DELETE /api/contacts/:id - Deletar contato (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const contato = await Contato.findOne({
      where: {
        id: req.params.id,
        empresa_id: req.empresaId
      }
    });

    if (!contato) {
      return res.status(404).json({ error: 'Contato não encontrado' });
    }

    // Soft delete - apenas marca como inativo
    await contato.update({ ativo: false });

    res.json({
      success: true,
      message: 'Contato removido com sucesso'
    });

  } catch (error) {
    console.error('Erro ao deletar contato:', error);
    res.status(500).json({ error: 'Erro ao deletar contato' });
  }
});

// Função auxiliar para formatar tempo relativo
function formatRelativeTime(date) {
  const now = new Date();
  const past = new Date(date);
  const diffInSeconds = Math.floor((now - past) / 1000);
  
  if (diffInSeconds < 60) return 'agora mesmo';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} min atrás`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h atrás`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)} dias atrás`;
  
  return past.toLocaleDateString('pt-BR');
}

module.exports = router;