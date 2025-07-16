// backend/src/scripts/initDatabase.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

// Usar caminhos relativos diretos
const { sequelize } = require('../../../shared/database');
const { 
  Empresa, 
  PipelineEtapa,
  CanalIntegracao 
} = require('../../../shared/models');

async function initDatabase() {
  try {
    console.log('Iniciando setup do banco de dados...');
    console.log('Verificando modelos carregados...');
    console.log('CanalIntegracao:', !!CanalIntegracao);

    // Criar empresa padrão se não existir
    const empresaId = process.env.DEFAULT_EMPRESA_ID || '00000000-0000-0000-0000-000000000001';
    
    let empresa = await Empresa.findByPk(empresaId);
    
    if (!empresa) {
      empresa = await Empresa.create({
        id: empresaId,
        nome: 'Maya CRM Demo',
        email: 'admin@mayacrm.com',
        telefone: '11999999999',
        plano: 'premium',
        ativo: true
      });
      console.log('Empresa padrão criada');
    } else {
      console.log('Empresa padrão já existe');
    }

    // Criar etapas do pipeline se não existirem
    const etapasPadrao = [
      { nome: 'Novos Leads', descricao: 'Leads que acabaram de entrar', cor: '#3B82F6', ordem: 1, tipo: 'normal' },
      { nome: 'Qualificados', descricao: 'Leads com potencial confirmado', cor: '#8B5CF6', ordem: 2, tipo: 'normal' },
      { nome: 'Proposta', descricao: 'Proposta enviada', cor: '#F59E0B', ordem: 3, tipo: 'normal' },
      { nome: 'Negociação', descricao: 'Em negociação final', cor: '#F97316', ordem: 4, tipo: 'normal' },
      { nome: 'Ganhos', descricao: 'Negócios fechados', cor: '#10B981', ordem: 5, tipo: 'ganho' },
      { nome: 'Perdidos', descricao: 'Oportunidades perdidas', cor: '#EF4444', ordem: 6, tipo: 'perdido' }
    ];

    for (const etapa of etapasPadrao) {
      const existe = await PipelineEtapa.findOne({
        where: {
          empresa_id: empresaId,
          ordem: etapa.ordem
        }
      });

      if (!existe) {
        await PipelineEtapa.create({
          ...etapa,
          empresa_id: empresaId
        });
        console.log(`Etapa "${etapa.nome}" criada`);
      }
    }

    // SKIP canal WhatsApp por enquanto para evitar o erro
    console.log('✅ Banco de dados inicializado com sucesso!');
    return true;

  } catch (error) {
    console.error('Erro ao inicializar banco:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  }
}

// Se executado diretamente
if (require.main === module) {
  initDatabase()
    .then(() => {
      console.log('Script concluído');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Erro no script:', error);
      process.exit(1);
    });
}

module.exports = initDatabase;