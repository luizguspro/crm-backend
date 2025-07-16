// backend/src/services/conversationService.js
const { Contato, Conversa, Mensagem, Negocio, PipelineEtapa } = require('../models');
const logger = require('../utils/logger');

class ConversationService {
  constructor() {
    this.empresaId = process.env.DEFAULT_EMPRESA_ID || '00000000-0000-0000-0000-000000000001';
  }

  async findOrCreateContact(whatsapp, nome = null) {
    try {
      // Buscar contato existente
      let contato = await Contato.findOne({
        where: { 
          whatsapp: whatsapp,
          empresa_id: this.empresaId
        }
      });

      if (!contato) {
        // Criar novo contato
        contato = await Contato.create({
          empresa_id: this.empresaId,
          nome: nome || whatsapp,
          whatsapp: whatsapp,
          origem: 'WhatsApp',
          score: 50,
          ativo: true
        });

        logger.info(`Novo contato criado: ${whatsapp}`);

        // Criar negócio na primeira etapa
        const primeiraEtapa = await PipelineEtapa.findOne({
          where: { 
            empresa_id: this.empresaId,
            ordem: 1
          }
        });

        if (primeiraEtapa) {
          await Negocio.create({
            empresa_id: this.empresaId,
            contato_id: contato.id,
            etapa_id: primeiraEtapa.id,
            titulo: `Lead - ${nome || whatsapp}`,
            valor: 0,
            probabilidade: 25,
            origem: 'WhatsApp'
          });
        }
      }

      return contato;
    } catch (error) {
      logger.error('Erro ao criar/buscar contato:', error);
      throw error;
    }
  }

  async findOrCreateConversation(contatoId) {
    try {
      let conversa = await Conversa.findOne({
        where: {
          contato_id: contatoId,
          arquivada: false
        }
      });

      if (!conversa) {
        conversa = await Conversa.create({
          empresa_id: this.empresaId,
          contato_id: contatoId,
          canal_tipo: 'whatsapp',
          status: 'aberta',
          primeira_mensagem_em: new Date()
        });
      }

      return conversa;
    } catch (error) {
      logger.error('Erro ao criar/buscar conversa:', error);
      throw error;
    }
  }

  async saveMessage(conversaId, conteudo, remetenteTipo, metadata = {}) {
    try {
      const mensagem = await Mensagem.create({
        conversa_id: conversaId,
        remetente_tipo: remetenteTipo,
        conteudo: conteudo,
        tipo_conteudo: metadata.tipo || 'texto',
        metadata: metadata,
        transcricao: metadata.transcricao || null,
        lida: false,
        enviada: true
      });

      // Atualizar última mensagem na conversa
      await Conversa.update({
        ultima_mensagem_em: new Date()
      }, {
        where: { id: conversaId }
      });

      return mensagem;
    } catch (error) {
      logger.error('Erro ao salvar mensagem:', error);
      throw error;
    }
  }

  async updateContactScore(contatoId, action) {
    try {
      const contato = await Contato.findByPk(contatoId);
      if (!contato) return;

      let scoreChange = 0;
      switch (action) {
        case 'message_sent': scoreChange = 5; break;
        case 'property_viewed': scoreChange = 10; break;
        case 'schedule_requested': scoreChange = 20; break;
        case 'visit_scheduled': scoreChange = 30; break;
        default: scoreChange = 0;
      }

      const newScore = Math.min(100, contato.score + scoreChange);
      await contato.update({ score: newScore });

      logger.info(`Score do contato ${contatoId} atualizado para ${newScore}`);
    } catch (error) {
      logger.error('Erro ao atualizar score:', error);
    }
  }

  async advanceDealStage(negocioId) {
    try {
      const negocio = await Negocio.findByPk(negocioId);
      if (!negocio) return;

      // Buscar próxima etapa
      const etapaAtual = await PipelineEtapa.findByPk(negocio.etapa_id);
      const proximaEtapa = await PipelineEtapa.findOne({
        where: {
          empresa_id: this.empresaId,
          ordem: etapaAtual.ordem + 1,
          tipo: 'normal'
        }
      });

      if (proximaEtapa) {
        await negocio.update({
          etapa_id: proximaEtapa.id,
          probabilidade: Math.min(100, negocio.probabilidade + 25)
        });

        logger.info(`Negócio ${negocioId} avançou para etapa ${proximaEtapa.nome}`);
      }
    } catch (error) {
      logger.error('Erro ao avançar etapa:', error);
    }
  }
}

module.exports = ConversationService;