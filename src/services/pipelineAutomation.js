// backend/src/services/pipelineAutomation.js
const logger = require('../../../shared/utils/logger');
const { 
  Negocio, 
  PipelineEtapa, 
  Contato,
  Conversa,
  Mensagem,
  Usuario
} = require('../../../shared/models');

class PipelineAutomation {
  constructor() {
    this.isRunning = false;
    this.interval = null;
  }

  start() {
    if (this.isRunning) {
      logger.warn('Pipeline automation já está rodando');
      return;
    }

    this.isRunning = true;
    logger.info('Pipeline automation iniciado');
    
    // Executar a cada 5 minutos
    this.interval = setInterval(() => {
      this.runAutomations();
    }, 5 * 60 * 1000);
    
    // Executar imediatamente na primeira vez
    this.runAutomations();
  }

  stop() {
    if (!this.isRunning) {
      logger.warn('Pipeline automation não está rodando');
      return;
    }

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    
    this.isRunning = false;
    logger.info('Pipeline automation parado');
  }

  async runAutomations() {
    try {
      logger.info('Executando automações do pipeline...');
      
      // Por enquanto, apenas log
      // TODO: Implementar regras de automação
      await this.moveIdleDeals();
      await this.notifyStaleDeals();
      
      logger.info('Automações concluídas');
    } catch (error) {
      logger.error('Erro ao executar automações:', error);
    }
  }

  async moveIdleDeals() {
    // Exemplo: mover negócios parados há mais de 7 dias
    try {
      const seteDiasAtras = new Date();
      seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);
      
      const negociosParados = await Negocio.findAll({
        where: {
          ganho: null,
          atualizado_em: { $lt: seteDiasAtras }
        },
        include: [PipelineEtapa]
      });
      
      logger.info(`Encontrados ${negociosParados.length} negócios parados`);
      
      // TODO: Implementar lógica de movimentação
    } catch (error) {
      logger.error('Erro ao mover negócios parados:', error);
    }
  }

  async notifyStaleDeals() {
    // Exemplo: notificar sobre negócios sem interação
    try {
      const tresDiasAtras = new Date();
      tresDiasAtras.setDate(tresDiasAtras.getDate() - 3);
      
      // TODO: Implementar notificações
      logger.info('Verificação de negócios sem interação concluída');
    } catch (error) {
      logger.error('Erro ao notificar negócios parados:', error);
    }
  }
}

module.exports = new PipelineAutomation();