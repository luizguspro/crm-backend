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
} = require('../../models');
const logger = require('../../utils/logger');

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

// POST /api/contacts/import-with-mapping - Importar contatos com mapeamento personalizado
router.post('/import-with-mapping', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  const results = {
    total: 0,
    criados: 0,
    atualizados: 0,
    erros: 0,
    detalhesErros: []
  };

  try {
    // Parse dos mapeamentos
    const mappings = JSON.parse(req.body.mappings || '{}');
    const customFieldsConfig = JSON.parse(req.body.customFields || '[]');

    logger.info(`Iniciando importação com mapeamento personalizado`);

    // Processar CSV
    const processRow = async (data, rowNumber) => {
      results.total++;
      
      try {
        // Mapear dados do CSV para campos do sistema
        const contatoData = {
          empresa_id: req.empresaId,
          origem: 'importacao',
          score: 50,
          ativo: true
        };

        // Processar mapeamentos
        for (const [csvField, systemField] of Object.entries(mappings)) {
          if (!systemField || !data[csvField]) continue;

          const value = data[csvField].trim();

          // Mapear para campos do sistema
          switch (systemField) {
            case 'nome':
              contatoData.nome = value;
              break;
            case 'email':
              contatoData.email = value.toLowerCase();
              break;
            case 'telefone':
              contatoData.telefone = value;
              break;
            case 'whatsapp':
              contatoData.whatsapp = value;
              break;
            case 'empresa':
              contatoData.empresa = value;
              break;
            case 'cargo':
              contatoData.cargo = value;
              break;
            case 'cpf_cnpj':
              contatoData.cpf_cnpj = value;
              break;
            case 'data_nascimento':
              const date = new Date(value);
              if (!isNaN(date)) {
                contatoData.data_nascimento = date;
              }
              break;
          }
        }

        // Validar nome obrigatório
        if (!contatoData.nome) {
          throw new Error('Nome é obrigatório');
        }

        // Se não tem whatsapp, usar telefone
        if (!contatoData.whatsapp && contatoData.telefone) {
          contatoData.whatsapp = contatoData.telefone;
        }

        // Verificar se já existe
        let contato = null;
        if (contatoData.email) {
          contato = await Contato.findOne({
            where: {
              empresa_id: req.empresaId,
              email: contatoData.email
            }
          });
        }

        if (!contato && contatoData.whatsapp) {
          contato = await Contato.findOne({
            where: {
              empresa_id: req.empresaId,
              whatsapp: contatoData.whatsapp
            }
          });
        }

        if (contato) {
          // Atualizar existente
          await contato.update(contatoData);
          results.atualizados++;
        } else {
          // Criar novo
          contato = await Contato.create(contatoData);
          results.criados++;
        }

      } catch (error) {
        results.erros++;
        results.detalhesErros.push({
          linha: rowNumber,
          erro: error.message,
          dados: data
        });
      }
    };

    // Ler e processar arquivo CSV
    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(req.file.path);
      let rowNumber = 0;
      const promises = [];

      stream
        .pipe(csv())
        .on('data', (data) => {
          rowNumber++;
          promises.push(processRow(data, rowNumber));
        })
        .on('end', async () => {
          // Aguardar todos os processamentos
          await Promise.all(promises);

          // Deletar arquivo temporário
          fs.unlinkSync(req.file.path);

          logger.info(`Importação concluída: ${results.criados} criados, ${results.atualizados} atualizados, ${results.erros} erros`);

          res.json({
            success: true,
            message: 'Importação concluída',
            ...results
          });
        })
        .on('error', (error) => {
          fs.unlinkSync(req.file.path);
          logger.error('Erro ao processar CSV:', error);
          res.status(500).json({ error: 'Erro ao processar arquivo CSV' });
        });
    });

  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    logger.error('Erro na importação:', error);
    res.status(500).json({ error: 'Erro ao importar contatos' });
  }
});

// POST /api/contacts/import - Importar contatos via CSV (método antigo simplificado)
router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  const results = [];
  const errors = [];
  let processados = 0;

  try {
    // Processar CSV
    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on('data', async (data) => {
        processados++;
        try {
          // Mapear campos do CSV
          const contatoData = {
            empresa_id: req.empresaId,
            nome: data.nome || data.Nome || data.name || data.Name,
            email: data.email || data.Email || data.EMAIL,
            telefone: data.telefone || data.Telefone || data.phone || data.Phone,
            whatsapp: data.whatsapp || data.WhatsApp || data.telefone || data.Telefone,
            empresa: data.empresa || data.Empresa || data.company || data.Company,
            cpf_cnpj: data.cpf || data.cnpj || data.CPF || data.CNPJ || data.documento,
            cargo: data.cargo || data.Cargo || data.position || data.Position,
            origem: 'importacao',
            score: 50,
            ativo: true
          };

          // Validar nome
          if (!contatoData.nome) {
            errors.push({
              linha: processados,
              erro: 'Nome é obrigatório'
            });
            return;
          }

          // Verificar se já existe
          let contato = null;
          if (contatoData.email) {
            contato = await Contato.findOne({
              where: {
                empresa_id: req.empresaId,
                email: contatoData.email
              }
            });
          }

          if (!contato && contatoData.whatsapp) {
            contato = await Contato.findOne({
              where: {
                empresa_id: req.empresaId,
                whatsapp: contatoData.whatsapp
              }
            });
          }

          if (contato) {
            // Atualizar existente
            await contato.update(contatoData);
            results.push({
              ...contatoData,
              status: 'atualizado'
            });
          } else {
            // Criar novo
            const novoContato = await Contato.create(contatoData);
            results.push({
              ...novoContato.toJSON(),
              status: 'criado'
            });
          }

        } catch (error) {
          errors.push({
            linha: processados,
            erro: error.message
          });
        }
      })
      .on('end', () => {
        // Deletar arquivo temporário
        fs.unlinkSync(req.file.path);

        res.json({
          success: true,
          message: `Importação concluída`,
          total: processados,
          criados: results.filter(r => r.status === 'criado').length,
          atualizados: results.filter(r => r.status === 'atualizado').length,
          erros: errors.length,
          detalhesErros: errors
        });
      })
      .on('error', (error) => {
        fs.unlinkSync(req.file.path);
        res.status(500).json({ error: 'Erro ao processar arquivo CSV' });
      });

  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Erro na importação:', error);
    res.status(500).json({ error: 'Erro ao importar contatos' });
  }
});

// GET /api/contacts/export - Exportar contatos
router.get('/export', async (req, res) => {
  try {
    const contatos = await Contato.findAll({
      where: {
        empresa_id: req.empresaId,
        ativo: true
      },
      order: [['nome', 'ASC']]
    });

    // Criar CSV
    const csvHeader = 'Nome,Email,Telefone,WhatsApp,Empresa,CPF/CNPJ,Cargo,Score,Origem,Data Cadastro\n';
    const csvContent = contatos.map(c => 
      `"${c.nome || ''}","${c.email || ''}","${c.telefone || ''}","${c.whatsapp || ''}","${c.empresa || ''}","${c.cpf_cnpj || ''}","${c.cargo || ''}",${c.score},"${c.origem || ''}","${c.criado_em.toISOString()}"`
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contatos.csv"');
    res.send('\ufeff' + csvHeader + csvContent); // BOM para UTF-8

  } catch (error) {
    console.error('Erro ao exportar contatos:', error);
    res.status(500).json({ error: 'Erro ao exportar contatos' });
  }
});

// GET /api/contacts/template - Baixar template CSV
router.get('/template', (req, res) => {
  const template = 'Nome,Email,Telefone,WhatsApp,Empresa,CPF/CNPJ,Cargo\n';
  const exemplo = '"João Silva","joao@empresa.com","11999999999","11999999999","Empresa ABC","123.456.789-00","Diretor"\n';
  
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="template_contatos.csv"');
  res.send('\ufeff' + template + exemplo);
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