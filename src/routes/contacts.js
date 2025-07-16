// backend/src/routes/contacts.js
const express = require('express');
const router = express.Router();
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  logging: false
});

// GET /api/contacts
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (page - 1) * limit;
    
    let whereClause = 'WHERE c.ativo = true';
    if (search) {
      whereClause += ` AND (
        LOWER(c.nome) LIKE LOWER('%${search}%') 
        OR LOWER(c.email) LIKE LOWER('%${search}%')
        OR c.telefone LIKE '%${search}%'
        OR c.whatsapp LIKE '%${search}%'
      )`;
    }
    
    const [contacts] = await sequelize.query(`
      SELECT 
        c.*,
        COUNT(n.id) as total_negocios,
        COALESCE(SUM(n.valor), 0) as valor_total_negocios,
        MAX(conv.ultima_mensagem_em) as ultimo_contato
      FROM "maya-crm".contatos c
      LEFT JOIN "maya-crm".negocios n ON n.contato_id = c.id
      LEFT JOIN "maya-crm".conversas conv ON conv.contato_id = c.id
      ${whereClause}
      GROUP BY c.id
      ORDER BY c.criado_em DESC
      LIMIT :limit OFFSET :offset
    `, {
      replacements: { limit: parseInt(limit), offset: parseInt(offset) }
    });
    
    const [[{ total }]] = await sequelize.query(`
      SELECT COUNT(*) as total 
      FROM "maya-crm".contatos c
      ${whereClause}
    `);
    
    res.json({
      data: contacts,
      total: parseInt(total),
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Erro ao buscar contatos:', error);
    res.status(500).json({ error: 'Erro ao buscar contatos' });
  }
});

// GET /api/contacts/:id
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [[contact]] = await sequelize.query(`
      SELECT c.*, 
        array_agg(DISTINCT t.nome) as tags,
        COUNT(DISTINCT n.id) as total_negocios,
        COUNT(DISTINCT conv.id) as total_conversas,
        COUNT(DISTINCT m.id) as total_mensagens
      FROM "maya-crm".contatos c
      LEFT JOIN "maya-crm".contatos_tags ct ON ct.contato_id = c.id
      LEFT JOIN "maya-crm".tags t ON t.id = ct.tag_id
      LEFT JOIN "maya-crm".negocios n ON n.contato_id = c.id
      LEFT JOIN "maya-crm".conversas conv ON conv.contato_id = c.id
      LEFT JOIN "maya-crm".mensagens m ON m.conversa_id = conv.id
      WHERE c.id = :id
      GROUP BY c.id
    `, {
      replacements: { id }
    });
    
    if (!contact) {
      return res.status(404).json({ error: 'Contato não encontrado' });
    }
    
    res.json(contact);
  } catch (error) {
    console.error('Erro ao buscar contato:', error);
    res.status(500).json({ error: 'Erro ao buscar contato' });
  }
});

module.exports = router;
