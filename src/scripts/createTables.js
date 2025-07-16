// backend/src/scripts/createTables.js
require('dotenv').config();
const { Client } = require('pg');
const logger = require('../utils/logger');

async function createAllTables() {
  const client = new Client({
    host: 'localhost',
    user: 'postgres',
    password: '32494565',
    database: 'maya-crm'
  });

  try {
    await client.connect();
    logger.info('Conectado ao banco maya-crm');

    // Verificar quais tabelas já existem
    const checkTablesQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE';
    `;

    const result = await client.query(checkTablesQuery);
    const existingTables = result.rows.map(row => row.table_name);
    logger.info(`Tabelas existentes: ${existingTables.join(', ')}`);

    // Array com todas as queries de criação de tabelas
    const tableQueries = [
      // Empresas
      {
        name: 'empresas',
        query: `
          CREATE TABLE IF NOT EXISTS empresas (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            nome VARCHAR(255) NOT NULL,
            cnpj VARCHAR(20) UNIQUE,
            telefone VARCHAR(20),
            email VARCHAR(255),
            endereco TEXT,
            plano VARCHAR(50) DEFAULT 'basico',
            ativo BOOLEAN DEFAULT true,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `
      },
      // Usuários
      {
        name: 'usuarios',
        query: `
          CREATE TABLE IF NOT EXISTS usuarios (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
            nome VARCHAR(255) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            senha VARCHAR(255) NOT NULL,
            cargo VARCHAR(100),
            avatar_url TEXT,
            telefone VARCHAR(20),
            ativo BOOLEAN DEFAULT true,
            ultimo_acesso TIMESTAMP,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `
      },
      // Contatos
      {
        name: 'contatos',
        query: `
          CREATE TABLE IF NOT EXISTS contatos (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
            nome VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            telefone VARCHAR(20),
            whatsapp VARCHAR(20),
            cpf_cnpj VARCHAR(20),
            data_nascimento DATE,
            empresa VARCHAR(255),
            cargo VARCHAR(100),
            origem VARCHAR(50),
            score INTEGER DEFAULT 0 CHECK (score >= 0 AND score <= 100),
            ativo BOOLEAN DEFAULT true,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `
      },
      // Tags
      {
        name: 'tags',
        query: `
          CREATE TABLE IF NOT EXISTS tags (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
            nome VARCHAR(100) NOT NULL,
            cor VARCHAR(7) DEFAULT '#3B82F6',
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(empresa_id, nome)
          );
        `
      },
      // Contatos Tags
      {
        name: 'contatos_tags',
        query: `
          CREATE TABLE IF NOT EXISTS contatos_tags (
            contato_id UUID REFERENCES contatos(id) ON DELETE CASCADE,
            tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (contato_id, tag_id)
          );
        `
      },
      // Campos customizados
      {
        name: 'campos_customizados',
        query: `
          CREATE TABLE IF NOT EXISTS campos_customizados (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
            nome VARCHAR(100) NOT NULL,
            tipo VARCHAR(50) NOT NULL,
            opcoes JSONB,
            obrigatorio BOOLEAN DEFAULT false,
            ordem INTEGER DEFAULT 0,
            ativo BOOLEAN DEFAULT true,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(empresa_id, nome)
          );
        `
      },
      // Canais integração
      {
        name: 'canais_integracao',
        query: `
          CREATE TABLE IF NOT EXISTS canais_integracao (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
            tipo VARCHAR(50) NOT NULL,
            nome VARCHAR(100),
            telefone VARCHAR(20),
            token_acesso TEXT,
            configuracoes JSONB,
            ativo BOOLEAN DEFAULT true,
            conectado BOOLEAN DEFAULT false,
            ultima_sincronizacao TIMESTAMP,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `
      },
      // Conversas
      {
        name: 'conversas',
        query: `
          CREATE TABLE IF NOT EXISTS conversas (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
            contato_id UUID REFERENCES contatos(id) ON DELETE SET NULL,
            canal_id UUID REFERENCES canais_integracao(id) ON DELETE SET NULL,
            canal_tipo VARCHAR(50) NOT NULL,
            status VARCHAR(50) DEFAULT 'aberta',
            prioridade VARCHAR(20) DEFAULT 'normal',
            atribuido_para UUID REFERENCES usuarios(id) ON DELETE SET NULL,
            primeira_mensagem_em TIMESTAMP,
            ultima_mensagem_em TIMESTAMP,
            tempo_primeira_resposta INTEGER,
            tempo_resolucao INTEGER,
            bot_ativo BOOLEAN DEFAULT false,
            arquivada BOOLEAN DEFAULT false,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `
      },
      // Mensagens
      {
        name: 'mensagens',
        query: `
          CREATE TABLE IF NOT EXISTS mensagens (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            conversa_id UUID REFERENCES conversas(id) ON DELETE CASCADE,
            remetente_tipo VARCHAR(20) NOT NULL,
            remetente_id UUID,
            conteudo TEXT,
            tipo_conteudo VARCHAR(50) DEFAULT 'texto',
            metadata JSONB,
            transcricao TEXT,
            lida BOOLEAN DEFAULT false,
            enviada BOOLEAN DEFAULT true,
            erro_envio TEXT,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `
      },
      // Pipeline etapas
      {
        name: 'pipeline_etapas',
        query: `
          CREATE TABLE IF NOT EXISTS pipeline_etapas (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
            nome VARCHAR(100) NOT NULL,
            descricao TEXT,
            cor VARCHAR(7) DEFAULT '#3B82F6',
            ordem INTEGER NOT NULL,
            tipo VARCHAR(20) DEFAULT 'normal',
            ativo BOOLEAN DEFAULT true,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(empresa_id, ordem)
          );
        `
      },
      // Negócios
      {
        name: 'negocios',
        query: `
          CREATE TABLE IF NOT EXISTS negocios (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
            contato_id UUID REFERENCES contatos(id) ON DELETE CASCADE,
            etapa_id UUID REFERENCES pipeline_etapas(id) ON DELETE SET NULL,
            titulo VARCHAR(255) NOT NULL,
            valor DECIMAL(15,2),
            moeda VARCHAR(3) DEFAULT 'BRL',
            probabilidade INTEGER DEFAULT 50 CHECK (probabilidade >= 0 AND probabilidade <= 100),
            previsao_fechamento DATE,
            responsavel_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
            origem VARCHAR(50),
            motivo_perda TEXT,
            fechado_em TIMESTAMP,
            ganho BOOLEAN,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `
      },
      // Tarefas
      {
        name: 'tarefas',
        query: `
          CREATE TABLE IF NOT EXISTS tarefas (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
            titulo VARCHAR(255) NOT NULL,
            descricao TEXT,
            tipo VARCHAR(50) DEFAULT 'tarefa',
            prioridade VARCHAR(20) DEFAULT 'normal',
            status VARCHAR(50) DEFAULT 'pendente',
            data_vencimento TIMESTAMP,
            data_conclusao TIMESTAMP,
            responsavel_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
            contato_id UUID REFERENCES contatos(id) ON DELETE CASCADE,
            negocio_id UUID REFERENCES negocios(id) ON DELETE CASCADE,
            criado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `
      },
      // Respostas rápidas
      {
        name: 'respostas_rapidas',
        query: `
          CREATE TABLE IF NOT EXISTS respostas_rapidas (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
            titulo VARCHAR(100) NOT NULL,
            conteudo TEXT NOT NULL,
            categoria VARCHAR(50),
            uso_contador INTEGER DEFAULT 0,
            ativo BOOLEAN DEFAULT true,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `
      },
      // Métricas diárias
      {
        name: 'metricas_diarias',
        query: `
          CREATE TABLE IF NOT EXISTS metricas_diarias (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
            data DATE NOT NULL,
            total_mensagens_recebidas INTEGER DEFAULT 0,
            total_mensagens_enviadas INTEGER DEFAULT 0,
            total_conversas_iniciadas INTEGER DEFAULT 0,
            total_conversas_resolvidas INTEGER DEFAULT 0,
            tempo_medio_resposta INTEGER,
            tempo_medio_resolucao INTEGER,
            novos_leads INTEGER DEFAULT 0,
            negocios_criados INTEGER DEFAULT 0,
            negocios_ganhos INTEGER DEFAULT 0,
            valor_total_ganho DECIMAL(15,2) DEFAULT 0,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(empresa_id, data)
          );
        `
      }
    ];

    // Criar cada tabela
    for (const table of tableQueries) {
      try {
        await client.query(table.query);
        logger.info(`✅ Tabela '${table.name}' criada/verificada`);
      } catch (error) {
        logger.error(`❌ Erro ao criar tabela '${table.name}':`, error.message);
      }
    }

    // Criar índices
    const indexQueries = [
      'CREATE INDEX IF NOT EXISTS idx_contatos_empresa ON contatos(empresa_id);',
      'CREATE INDEX IF NOT EXISTS idx_contatos_whatsapp ON contatos(whatsapp);',
      'CREATE INDEX IF NOT EXISTS idx_conversas_empresa ON conversas(empresa_id);',
      'CREATE INDEX IF NOT EXISTS idx_conversas_contato ON conversas(contato_id);',
      'CREATE INDEX IF NOT EXISTS idx_conversas_status ON conversas(status);',
      'CREATE INDEX IF NOT EXISTS idx_mensagens_conversa ON mensagens(conversa_id);',
      'CREATE INDEX IF NOT EXISTS idx_mensagens_criado ON mensagens(criado_em);',
      'CREATE INDEX IF NOT EXISTS idx_negocios_empresa ON negocios(empresa_id);',
      'CREATE INDEX IF NOT EXISTS idx_negocios_etapa ON negocios(etapa_id);'
    ];

    logger.info('Criando índices...');
    for (const query of indexQueries) {
      try {
        await client.query(query);
      } catch (error) {
        logger.error(`Erro ao criar índice: ${error.message}`);
      }
    }

    logger.info('✅ Todas as tabelas foram criadas/verificadas com sucesso!');

  } catch (error) {
    logger.error('Erro ao conectar ou criar tabelas:', error);
  } finally {
    await client.end();
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  createAllTables().then(() => {
    process.exit(0);
  });
}

module.exports = createAllTables;