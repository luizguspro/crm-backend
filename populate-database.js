// populate-database.js
// Execute na pasta backend: node populate-database.js

require('dotenv').config();
const { Sequelize } = require('sequelize');
const { v4: uuidv4 } = require('uuid');

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  logging: false
});

async function populateDatabase() {
  console.log('🚀 Iniciando população do banco de dados...\n');
  
  try {
    await sequelize.authenticate();
    console.log('✅ Conectado ao banco\n');
    
    // Obter empresa_id do admin
    const [[admin]] = await sequelize.query(`
      SELECT u.*, e.id as empresa_id 
      FROM "maya-crm".usuarios u 
      LEFT JOIN "maya-crm".empresas e ON u.empresa_id = e.id 
      WHERE u.email = 'admin@mayacrm.com'
    `);
    
    let empresaId = admin?.empresa_id;
    
    // Se não houver empresa, criar uma
    if (!empresaId) {
      console.log('📦 Criando empresa...');
      const [empresa] = await sequelize.query(`
        INSERT INTO "maya-crm".empresas (nome, email, telefone, plano)
        VALUES ('Maya Imóveis', 'contato@mayaimoveis.com', '(47) 3333-4444', 'profissional')
        RETURNING id
      `);
      empresaId = empresa[0].id;
      
      // Atualizar usuário admin
      await sequelize.query(`
        UPDATE "maya-crm".usuarios 
        SET empresa_id = :empresaId 
        WHERE id = :userId
      `, {
        replacements: { empresaId, userId: admin.id }
      });
      console.log('✅ Empresa criada');
    }
    
    // 1. CRIAR ETAPAS DO PIPELINE
    console.log('\n📊 Criando etapas do pipeline...');
    const etapas = [
      { nome: 'Novo Lead', ordem: 1, cor: '#3B82F6', tipo: 'inicial' },
      { nome: 'Qualificado', ordem: 2, cor: '#10B981' },
      { nome: 'Em Contato', ordem: 3, cor: '#F59E0B' },
      { nome: 'Visita Agendada', ordem: 4, cor: '#8B5CF6' },
      { nome: 'Proposta Enviada', ordem: 5, cor: '#EC4899' },
      { nome: 'Negociação', ordem: 6, cor: '#F97316' },
      { nome: 'Fechado/Ganho', ordem: 7, cor: '#22C55E', tipo: 'ganho' },
      { nome: 'Perdido', ordem: 8, cor: '#EF4444', tipo: 'perda' }
    ];
    
    const etapaIds = {};
    for (const etapa of etapas) {
      const [result] = await sequelize.query(`
        INSERT INTO "maya-crm".pipeline_etapas (empresa_id, nome, ordem, cor, tipo)
        VALUES (:empresaId, :nome, :ordem, :cor, :tipo)
        ON CONFLICT DO NOTHING
        RETURNING id
      `, {
        replacements: { empresaId, ...etapa, tipo: etapa.tipo || 'normal' }
      });
      
      if (result.length > 0) {
        etapaIds[etapa.nome] = result[0].id;
      } else {
        // Se já existir, buscar o ID
        const [[existing]] = await sequelize.query(`
          SELECT id FROM "maya-crm".pipeline_etapas 
          WHERE empresa_id = :empresaId AND nome = :nome
        `, {
          replacements: { empresaId, nome: etapa.nome }
        });
        if (existing) etapaIds[etapa.nome] = existing.id;
      }
    }
    console.log('✅ Pipeline criado');
    
    // 2. CRIAR TAGS
    console.log('\n🏷️ Criando tags...');
    const tags = [
      { nome: 'Prioridade Alta', cor: '#EF4444' },
      { nome: 'Cliente VIP', cor: '#F59E0B' },
      { nome: 'Indicação', cor: '#10B981' },
      { nome: 'Site', cor: '#3B82F6' },
      { nome: 'Instagram', cor: '#EC4899' },
      { nome: 'WhatsApp', cor: '#22C55E' }
    ];
    
    const tagIds = {};
    for (const tag of tags) {
      const [result] = await sequelize.query(`
        INSERT INTO "maya-crm".tags (empresa_id, nome, cor)
        VALUES (:empresaId, :nome, :cor)
        ON CONFLICT DO NOTHING
        RETURNING id
      `, {
        replacements: { empresaId, ...tag }
      });
      
      if (result.length > 0) {
        tagIds[tag.nome] = result[0].id;
      }
    }
    console.log('✅ Tags criadas');
    
    // 3. CRIAR CONTATOS
    console.log('\n👥 Criando contatos...');
    const contatos = [
      // Leads Quentes (criados hoje)
      { nome: 'João Silva', email: 'joao.silva@email.com', telefone: '(47) 98888-1111', whatsapp: '47988881111', origem: 'WhatsApp', score: 85, criado_em: 'NOW()' },
      { nome: 'Maria Santos', email: 'maria.santos@email.com', telefone: '(47) 98888-2222', whatsapp: '47988882222', origem: 'Instagram', score: 92, criado_em: 'NOW()' },
      { nome: 'Pedro Oliveira', email: 'pedro.oliveira@email.com', telefone: '(47) 98888-3333', whatsapp: '47988883333', origem: 'Site', score: 78, criado_em: 'NOW()' },
      
      // Leads da semana
      { nome: 'Ana Costa', email: 'ana.costa@email.com', telefone: '(47) 98888-4444', whatsapp: '47988884444', origem: 'Facebook', score: 65, criado_em: "NOW() - INTERVAL '2 days'" },
      { nome: 'Carlos Ferreira', email: 'carlos.ferreira@email.com', telefone: '(47) 98888-5555', whatsapp: '47988885555', origem: 'Indicação', score: 88, criado_em: "NOW() - INTERVAL '3 days'" },
      { nome: 'Beatriz Lima', email: 'beatriz.lima@email.com', telefone: '(47) 98888-6666', whatsapp: '47988886666', origem: 'WhatsApp', score: 70, criado_em: "NOW() - INTERVAL '4 days'" },
      
      // Leads do mês
      { nome: 'Lucas Mendes', email: 'lucas.mendes@email.com', telefone: '(47) 98888-7777', whatsapp: '47988887777', origem: 'Site', score: 95, criado_em: "NOW() - INTERVAL '7 days'" },
      { nome: 'Juliana Rocha', email: 'juliana.rocha@email.com', telefone: '(47) 98888-8888', whatsapp: '47988888888', origem: 'Instagram', score: 82, criado_em: "NOW() - INTERVAL '10 days'" },
      { nome: 'Roberto Alves', email: 'roberto.alves@email.com', telefone: '(47) 98888-9999', whatsapp: '47988889999', origem: 'WhatsApp', score: 77, criado_em: "NOW() - INTERVAL '15 days'" },
      { nome: 'Fernanda Silva', email: 'fernanda.silva@email.com', telefone: '(47) 98777-1111', whatsapp: '47987771111', origem: 'Facebook', score: 90, criado_em: "NOW() - INTERVAL '20 days'" }
    ];
    
    const contatoIds = [];
    for (const contato of contatos) {
      const [result] = await sequelize.query(`
        INSERT INTO "maya-crm".contatos 
        (empresa_id, nome, email, telefone, whatsapp, origem, score, criado_em, atualizado_em)
        VALUES (:empresaId, :nome, :email, :telefone, :whatsapp, :origem, :score, ${contato.criado_em}, NOW())
        RETURNING id
      `, {
        replacements: { empresaId, ...contato }
      });
      contatoIds.push({ id: result[0].id, ...contato });
    }
    console.log(`✅ ${contatoIds.length} contatos criados`);
    
    // 4. CRIAR CANAIS DE INTEGRAÇÃO
    console.log('\n📱 Criando canais de integração...');
    const canais = [
      { tipo: 'whatsapp', nome: 'WhatsApp Principal', telefone: '47999887766', conectado: true },
      { tipo: 'instagram', nome: 'Instagram Maya', conectado: true },
      { tipo: 'facebook', nome: 'Facebook Maya Imóveis', conectado: true },
      { tipo: 'email', nome: 'Email Principal', conectado: true }
    ];
    
    const canalIds = {};
    for (const canal of canais) {
      const [result] = await sequelize.query(`
        INSERT INTO "maya-crm".canais_integracao 
        (empresa_id, tipo, nome, telefone, conectado, ultima_sincronizacao)
        VALUES (:empresaId, :tipo, :nome, :telefone, :conectado, NOW())
        ON CONFLICT DO NOTHING
        RETURNING id
      `, {
        replacements: { empresaId, ...canal }
      });
      
      if (result.length > 0) {
        canalIds[canal.tipo] = result[0].id;
      }
    }
    console.log('✅ Canais criados');
    
    // 5. CRIAR CONVERSAS E MENSAGENS
    console.log('\n💬 Criando conversas e mensagens...');
    let conversaCount = 0;
    let mensagemCount = 0;
    
    for (const contato of contatoIds.slice(0, 7)) {
      // Definir canal baseado na origem
      const canalTipo = contato.origem.toLowerCase() === 'indicação' ? 'whatsapp' : contato.origem.toLowerCase();
      const canalId = canalIds[canalTipo] || canalIds['whatsapp'];
      
      // Criar conversa
      const [conversa] = await sequelize.query(`
        INSERT INTO "maya-crm".conversas 
        (empresa_id, contato_id, canal_id, canal_tipo, status, primeira_mensagem_em, ultima_mensagem_em, criado_em)
        VALUES (:empresaId, :contatoId, :canalId, :canalTipo, 'aberta', ${contato.criado_em}, NOW(), ${contato.criado_em})
        RETURNING id
      `, {
        replacements: { 
          empresaId, 
          contatoId: contato.id, 
          canalId,
          canalTipo 
        }
      });
      conversaCount++;
      
      // Criar algumas mensagens
      const mensagens = [
        { tipo: 'contato', conteudo: 'Olá, vi o anúncio do apartamento no Jardim Botânico. Ainda está disponível?' },
        { tipo: 'usuario', conteudo: 'Olá! Sim, ainda está disponível. É um apartamento de 3 quartos com 120m². Gostaria de agendar uma visita?' },
        { tipo: 'contato', conteudo: 'Sim, gostaria! Qual o valor?' },
        { tipo: 'usuario', conteudo: 'O valor é R$ 850.000. Posso agendar uma visita para você conhecer?' }
      ];
      
      for (const [index, msg] of mensagens.entries()) {
        await sequelize.query(`
          INSERT INTO "maya-crm".mensagens 
          (conversa_id, remetente_tipo, remetente_id, conteudo, lida, criado_em)
          VALUES (:conversaId, :remetenteTipo, :remetenteId, :conteudo, true, ${contato.criado_em} + INTERVAL '${index * 5} minutes')
        `, {
          replacements: {
            conversaId: conversa[0].id,
            remetenteTipo: msg.tipo,
            remetenteId: msg.tipo === 'usuario' ? admin.id : contato.id,
            conteudo: msg.conteudo
          }
        });
        mensagemCount++;
      }
      
      // Atualizar última mensagem da conversa
      await sequelize.query(`
        UPDATE "maya-crm".conversas 
        SET ultima_mensagem = :ultimaMensagem,
            ultima_mensagem_em = ${contato.criado_em} + INTERVAL '15 minutes'
        WHERE id = :conversaId
      `, {
        replacements: {
          conversaId: conversa[0].id,
          ultimaMensagem: mensagens[mensagens.length - 1].conteudo
        }
      });
    }
    console.log(`✅ ${conversaCount} conversas e ${mensagemCount} mensagens criadas`);
    
    // 6. CRIAR NEGÓCIOS
    console.log('\n💼 Criando negócios...');
    const negocios = [
      // Negócios ganhos
      { contato: contatoIds[7], etapa: 'Fechado/Ganho', titulo: 'Apartamento Jardim Botânico', valor: 850000, ganho: true, fechado_em: "NOW() - INTERVAL '5 days'" },
      { contato: contatoIds[8], etapa: 'Fechado/Ganho', titulo: 'Casa Centro', valor: 1200000, ganho: true, fechado_em: "NOW() - INTERVAL '10 days'" },
      { contato: contatoIds[9], etapa: 'Fechado/Ganho', titulo: 'Cobertura Vista Mar', valor: 2500000, ganho: true, fechado_em: "NOW() - INTERVAL '15 days'" },
      
      // Negócios em andamento
      { contato: contatoIds[0], etapa: 'Proposta Enviada', titulo: 'Apartamento 2 quartos', valor: 450000 },
      { contato: contatoIds[1], etapa: 'Visita Agendada', titulo: 'Casa em condomínio', valor: 780000 },
      { contato: contatoIds[2], etapa: 'Negociação', titulo: 'Sala comercial', valor: 320000 },
      { contato: contatoIds[3], etapa: 'Em Contato', titulo: 'Terreno industrial', valor: 1500000 },
      { contato: contatoIds[4], etapa: 'Qualificado', titulo: 'Apartamento na planta', valor: 580000 },
      
      // Negócio perdido
      { contato: contatoIds[5], etapa: 'Perdido', titulo: 'Loft Centro', valor: 280000, ganho: false, motivo_perda: 'Preço acima do orçamento' }
    ];
    
    let negocioCount = 0;
    for (const negocio of negocios) {
      const etapaId = etapaIds[negocio.etapa];
      await sequelize.query(`
        INSERT INTO "maya-crm".negocios 
        (empresa_id, contato_id, etapa_id, titulo, valor, responsavel_id, origem, 
         probabilidade, ganho, motivo_perda, fechado_em, criado_em)
        VALUES (:empresaId, :contatoId, :etapaId, :titulo, :valor, :responsavelId, 
                :origem, :probabilidade, :ganho, :motivoPerda, ${negocio.fechado_em || 'NULL'}, 
                ${negocio.fechado_em || 'NOW() - INTERVAL \'7 days\''})
      `, {
        replacements: {
          empresaId,
          contatoId: negocio.contato.id,
          etapaId,
          titulo: negocio.titulo,
          valor: negocio.valor,
          responsavelId: admin.id,
          origem: negocio.contato.origem,
          probabilidade: negocio.ganho ? 100 : (negocio.ganho === false ? 0 : 50),
          ganho: negocio.ganho || null,
          motivoPerda: negocio.motivo_perda || null
        }
      });
      negocioCount++;
    }
    console.log(`✅ ${negocioCount} negócios criados`);
    
    // 7. CRIAR TAREFAS
    console.log('\n📋 Criando tarefas...');
    const tarefas = [
      { titulo: 'Visita apartamento Jardim Botânico', tipo: 'visita', contato: contatoIds[0], vencimento: "NOW() + INTERVAL '1 day'" },
      { titulo: 'Visita casa em condomínio', tipo: 'visita', contato: contatoIds[1], vencimento: "NOW() + INTERVAL '2 days'" },
      { titulo: 'Enviar documentação', tipo: 'tarefa', contato: contatoIds[2], vencimento: "NOW() + INTERVAL '3 hours'" },
      { titulo: 'Follow-up proposta', tipo: 'ligacao', contato: contatoIds[3], vencimento: "NOW() + INTERVAL '1 day'", prioridade: 'alta' },
      { titulo: 'Preparar contrato', tipo: 'tarefa', contato: contatoIds[4], vencimento: "NOW() + INTERVAL '2 days'" }
    ];
    
    for (const tarefa of tarefas) {
      await sequelize.query(`
        INSERT INTO "maya-crm".tarefas 
        (empresa_id, titulo, tipo, prioridade, status, data_vencimento, responsavel_id, contato_id, criado_por)
        VALUES (:empresaId, :titulo, :tipo, :prioridade, 'pendente', ${tarefa.vencimento}, :responsavelId, :contatoId, :criadoPor)
      `, {
        replacements: {
          empresaId,
          titulo: tarefa.titulo,
          tipo: tarefa.tipo,
          prioridade: tarefa.prioridade || 'normal',
          responsavelId: admin.id,
          contatoId: tarefa.contato.id,
          criadoPor: admin.id
        }
      });
    }
    console.log(`✅ ${tarefas.length} tarefas criadas`);
    
    // 8. CRIAR MÉTRICAS DIÁRIAS
    console.log('\n📊 Criando métricas diárias...');
    for (let i = 0; i < 30; i++) {
      const data = `CURRENT_DATE - INTERVAL '${i} days'`;
      await sequelize.query(`
        INSERT INTO "maya-crm".metricas_diarias 
        (empresa_id, data, total_mensagens_recebidas, total_mensagens_enviadas, 
         total_conversas_iniciadas, novos_leads, negocios_criados)
        VALUES (:empresaId, ${data}, 
                :msgRecebidas, :msgEnviadas, :conversasIniciadas, :novosLeads, :negociosCriados)
        ON CONFLICT DO NOTHING
      `, {
        replacements: {
          empresaId,
          msgRecebidas: Math.floor(Math.random() * 50) + 10,
          msgEnviadas: Math.floor(Math.random() * 40) + 8,
          conversasIniciadas: Math.floor(Math.random() * 10) + 2,
          novosLeads: Math.floor(Math.random() * 5) + 1,
          negociosCriados: Math.floor(Math.random() * 3)
        }
      });
    }
    console.log('✅ Métricas diárias criadas');
    
    await sequelize.close();
    
    console.log('\n🎉 Banco de dados populado com sucesso!');
    console.log('\n📊 Resumo dos dados criados:');
    console.log(`- ${etapas.length} etapas do pipeline`);
    console.log(`- ${tags.length} tags`);
    console.log(`- ${contatoIds.length} contatos`);
    console.log(`- ${conversaCount} conversas`);
    console.log(`- ${mensagemCount} mensagens`);
    console.log(`- ${negocioCount} negócios`);
    console.log(`- ${tarefas.length} tarefas`);
    console.log(`- 30 dias de métricas`);
    
    console.log('\n✨ Agora seu dashboard terá dados reais para mostrar!');
    
  } catch (error) {
    console.error('❌ Erro:', error);
  }
}

// Verificar se uuid está disponível
try {
  require('uuid');
  populateDatabase();
} catch (error) {
  console.log('⚠️  Instalando dependência uuid...');
  require('child_process').execSync('npm install uuid', { stdio: 'inherit' });
  populateDatabase();
}