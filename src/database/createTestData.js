// backend/src/database/createTestData.js
const { sequelize } = require('./index');
const { 
  Empresa,
  Contato,
  PipelineEtapa,
  Negocio,
  Conversa
} = require('../models');
const logger = require('../utils/logger');

async function createTestData() {
  try {
    logger.info('🔧 Criando dados de teste para automação...');

    // Verificar conexão
    await sequelize.authenticate();
    
    const empresaId = '00000000-0000-0000-0000-000000000001';

    // Buscar etapas
    const etapaNovos = await PipelineEtapa.findOne({
      where: { empresa_id: empresaId, ordem: 1 }
    });

    const etapaQualificados = await PipelineEtapa.findOne({
      where: { empresa_id: empresaId, ordem: 2 }
    });

    if (!etapaNovos || !etapaQualificados) {
      logger.error('Etapas do pipeline não encontradas. Execute primeiro: npm run db:seed');
      return;
    }

    // Criar contatos de teste
    const contatosData = [
      {
        empresa_id: empresaId,
        nome: 'João Silva - Cliente Quente',
        email: 'joao.quente@teste.com',
        whatsapp: '11999999001',
        score: 85,
        origem: 'website'
      },
      {
        empresa_id: empresaId,
        nome: 'Maria Santos - Sem Resposta',
        email: 'maria.fria@teste.com',
        whatsapp: '11999999002',
        score: 60,
        origem: 'instagram'
      },
      {
        empresa_id: empresaId,
        nome: 'Pedro Oliveira - Score Alto',
        email: 'pedro.alto@teste.com',
        whatsapp: '11999999003',
        score: 75,
        origem: 'whatsapp'
      }
    ];

    const contatos = [];
    for (const data of contatosData) {
      const contato = await Contato.create(data);
      contatos.push(contato);
      logger.info(`✅ Contato criado: ${contato.nome} (Score: ${contato.score})`);
    }

    // Criar negócios
    // 1. Cliente Quente - deve ir para "Em Negociação"
    const negocio1 = await Negocio.create({
      empresa_id: empresaId,
      contato_id: contatos[0].id,
      etapa_id: etapaQualificados.id, // Já qualificado
      titulo: 'Negócio Quente - Apartamento Centro',
      valor: 450000,
      probabilidade: 75,
      origem: 'website'
    });

    // Criar conversa recente para ele
    await Conversa.create({
      empresa_id: empresaId,
      contato_id: contatos[0].id,
      canal_tipo: 'whatsapp',
      status: 'ativa',
      ultima_mensagem_em: new Date() // Interação agora
    });

    logger.info(`✅ Negócio 1: ${negocio1.titulo} - Deve ir para "Em Negociação"`);

    // 2. Sem Resposta - deve ir para "Cadência"
    const negocio2 = await Negocio.create({
      empresa_id: empresaId,
      contato_id: contatos[1].id,
      etapa_id: etapaNovos.id,
      titulo: 'Lead Frio - Casa Praia',
      valor: 650000,
      probabilidade: 40,
      origem: 'instagram',
      criado_em: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) // 4 dias atrás
    });

    // Sem conversa = sem resposta
    logger.info(`✅ Negócio 2: ${negocio2.titulo} - Deve ir para "Cadência de Contato"`);

    // 3. Score Alto - deve ser qualificado
    const negocio3 = await Negocio.create({
      empresa_id: empresaId,
      contato_id: contatos[2].id,
      etapa_id: etapaNovos.id,
      titulo: 'Lead com Potencial - Cobertura',
      valor: 1200000,
      probabilidade: 50,
      origem: 'whatsapp'
    });

    // Criar conversa para qualificar
    await Conversa.create({
      empresa_id: empresaId,
      contato_id: contatos[2].id,
      canal_tipo: 'whatsapp',
      status: 'ativa',
      ultima_mensagem_em: new Date(Date.now() - 24 * 60 * 60 * 1000) // 1 dia atrás
    });

    logger.info(`✅ Negócio 3: ${negocio3.titulo} - Deve ser qualificado`);

    // Resumo
    logger.info('\n📊 Resumo dos dados criados:');
    logger.info('- 3 contatos com diferentes scores');
    logger.info('- 3 negócios em diferentes situações');
    logger.info('- Conversas simuladas');
    logger.info('\n🤖 Quando a automação executar:');
    logger.info('1. João (score 85, qualificado) → Em Negociação');
    logger.info('2. Maria (sem resposta há 4 dias) → Cadência de Contato');
    logger.info('3. Pedro (score 75, teve interação) → Qualificados');

  } catch (error) {
    logger.error('❌ Erro ao criar dados de teste:', error);
  } finally {
    await sequelize.close();
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  createTestData();
}

module.exports = createTestData;