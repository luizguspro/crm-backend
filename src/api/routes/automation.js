// backend/src/api/routes/automation.js
const express = require('express');
const router = express.Router();
const pipelineAutomation = require('../../services/pipelineAutomation');
const { AutomacaoFluxo, AutomacaoExecucao } = require('../../models');
const logger = require('../../utils/logger');

// Middleware temporário para empresa padrão
const setDefaultEmpresa = (req, res, next) => {
  req.empresaId = process.env.DEFAULT_EMPRESA_ID || '00000000-0000-0000-0000-000000000001';
  next();
};

router.use(setDefaultEmpresa);

// GET /api/automation/status - Status da automação
router.get('/status', (req, res) => {
  res.json({
    isRunning: pipelineAutomation.isRunning,
    timestamp: new Date()
  });
});

// POST /api/automation/start - Iniciar automação
router.post('/start', (req, res) => {
  try {
    pipelineAutomation.start();
    res.json({
      success: true,
      message: 'Automação iniciada com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao iniciar automação:', error);
    res.status(500).json({
      error: 'Erro ao iniciar automação'
    });
  }
});

// POST /api/automation/stop - Parar automação
router.post('/stop', (req, res) => {
  try {
    pipelineAutomation.stop();
    res.json({
      success: true,
      message: 'Automação parada com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao parar automação:', error);
    res.status(500).json({
      error: 'Erro ao parar automação'
    });
  }
});

// POST /api/automation/run-now - Executar automação imediatamente
router.post('/run-now', async (req, res) => {
  try {
    // Executar em background
    pipelineAutomation.runAutomations()
      .then(() => {
        logger.info('Automação executada manualmente com sucesso');
      })
      .catch(error => {
        logger.error('Erro na execução manual da automação:', error);
      });

    res.json({
      success: true,
      message: 'Automação iniciada em background'
    });
  } catch (error) {
    logger.error('Erro ao executar automação:', error);
    res.status(500).json({
      error: 'Erro ao executar automação'
    });
  }
});

// GET /api/automation/flows - Listar fluxos de automação
router.get('/flows', async (req, res) => {
  try {
    // Por enquanto, retornar as automações hardcoded
    const flows = [
      {
        id: 'auto-qualify-hot',
        nome: 'Cliente Quente → Em Negociação',
        descricao: 'Move automaticamente clientes com score alto e interação recente',
        gatilho: 'Score >= 80 e interação < 48h',
        ativo: true,
        regras: {
          score_minimo: 80,
          probabilidade_minima: 70,
          tempo_interacao: 48
        }
      },
      {
        id: 'auto-cadence',
        nome: 'Cadência de Contato',
        descricao: 'Move leads sem resposta para cadência de follow-up',
        gatilho: 'Sem resposta por 72h',
        ativo: true,
        regras: {
          tempo_sem_resposta: 72,
          criar_tarefa: true
        }
      },
      {
        id: 'auto-qualify-score',
        nome: 'Qualificação por Score',
        descricao: 'Qualifica automaticamente leads com score alto',
        gatilho: 'Score >= 70 e teve interação',
        ativo: true,
        regras: {
          score_minimo: 70,
          requer_interacao: true
        }
      },
      {
        id: 'auto-lost',
        nome: 'Marcar como Perdido',
        descricao: 'Move para perdido após 30 dias sem resposta',
        gatilho: 'Sem interação por 30 dias',
        ativo: true,
        regras: {
          dias_sem_resposta: 30
        }
      }
    ];

    res.json(flows);
  } catch (error) {
    logger.error('Erro ao buscar fluxos:', error);
    res.status(500).json({
      error: 'Erro ao buscar fluxos de automação'
    });
  }
});

// PUT /api/automation/flows/:id - Atualizar configuração de fluxo
router.put('/flows/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { ativo, regras } = req.body;

    // Por enquanto, apenas retornar sucesso
    // Em produção, salvar em AutomacaoFluxo
    
    res.json({
      success: true,
      message: 'Configuração atualizada',
      flow: {
        id,
        ativo,
        regras
      }
    });
  } catch (error) {
    logger.error('Erro ao atualizar fluxo:', error);
    res.status(500).json({
      error: 'Erro ao atualizar configuração'
    });
  }
});

// GET /api/automation/history - Histórico de execuções
router.get('/history', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    // Se o modelo existir, buscar do banco
    if (AutomacaoExecucao) {
      const execucoes = await AutomacaoExecucao.findAll({
        where: {
          entidade_tipo: 'negocio'
        },
        order: [['criado_em', 'DESC']],
        limit: parseInt(limit),
        offset: parseInt(offset)
      });

      res.json({
        execucoes,
        total: await AutomacaoExecucao.count({
          where: { entidade_tipo: 'negocio' }
        })
      });
    } else {
      // Retornar dados mockados
      res.json({
        execucoes: [],
        total: 0
      });
    }
  } catch (error) {
    logger.error('Erro ao buscar histórico:', error);
    res.status(500).json({
      error: 'Erro ao buscar histórico de execuções'
    });
  }
});

module.exports = router;