// backend/src/services/whatsappMultiTenant.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const { Sequelize } = require('sequelize');

class WhatsAppMultiTenant {
  constructor() {
    // Mapa de clientes WhatsApp por empresa
    this.clients = new Map(); // empresaId -> { client, status, qrCode, info }
    this.io = null;
    this.db = null;
    this.initDatabase();
  }

  initDatabase() {
    this.db = new Sequelize(process.env.DATABASE_URL || 
      `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`, {
      dialect: 'postgres',
      logging: false
    });
  }

  // ============================================
  // GERENCIAMENTO DE CLIENTES POR EMPRESA
  // ============================================

  async initializeForCompany(empresaId, userId, io = null) {
    console.log(`🔄 Inicializando WhatsApp para empresa: ${empresaId}`);
    
    // Se já existe um cliente para esta empresa, retornar status
    if (this.clients.has(empresaId)) {
      const existing = this.clients.get(empresaId);
      if (existing.status === 'connected') {
        return {
          success: true,
          status: 'already_connected',
          info: existing.info
        };
      }
    }

    // Buscar configurações da empresa
    const [configs] = await this.db.query(`
      SELECT 
        nome,
        configuracoes_bot,
        mensagem_boas_vindas,
        horario_atendimento_inicio,
        horario_atendimento_fim,
        mensagem_fora_horario,
        resposta_automatica_ativa
      FROM "maya-crm".empresas
      WHERE id = :empresaId
    `, {
      replacements: { empresaId }
    });

    const empresaConfig = configs[0] || {};

    // Criar novo cliente WhatsApp
    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: `empresa-${empresaId}`,
        dataPath: './whatsapp-sessions'
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      },
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
      }
    });

    // Armazenar referência
    this.clients.set(empresaId, {
      client: client,
      status: 'initializing',
      qrCode: null,
      info: null,
      empresaId: empresaId,
      userId: userId,
      config: empresaConfig,
      io: io || this.io
    });

    // Configurar eventos
    this.setupClientEvents(client, empresaId);

    // Inicializar
    try {
      await client.initialize();
      return {
        success: true,
        status: 'initializing',
        message: 'WhatsApp iniciando...'
      };
    } catch (error) {
      console.error(`Erro ao inicializar WhatsApp para empresa ${empresaId}:`, error);
      this.clients.delete(empresaId);
      throw error;
    }
  }

  setupClientEvents(client, empresaId) {
    const companyData = this.clients.get(empresaId);

    // QR Code
    client.on('qr', async (qr) => {
      console.log(`📱 QR Code gerado para empresa ${empresaId}`);
      
      companyData.qrCode = qr;
      companyData.status = 'waiting_qr';
      
      // Gerar base64
      const qrDataUrl = await qrcode.toDataURL(qr);
      
      // Emitir via Socket.io para a empresa específica
      if (companyData.io) {
        companyData.io.to(`empresa-${empresaId}`).emit('whatsapp:qr', {
          qr: qrDataUrl,
          status: 'waiting',
          empresaId: empresaId
        });
      }
      
      // Salvar QR temporário no banco para recuperação
      await this.db.query(`
        UPDATE "maya-crm".canais_integracao
        SET 
          qr_code_temp = :qr,
          qr_code_expira_em = NOW() + INTERVAL '2 minutes'
        WHERE empresa_id = :empresaId
        AND tipo = 'whatsapp'
      `, {
        replacements: { qr: qrDataUrl, empresaId }
      });
    });

    // Autenticado
    client.on('authenticated', () => {
      console.log(`✅ WhatsApp autenticado para empresa ${empresaId}`);
      companyData.qrCode = null;
      companyData.status = 'authenticated';
      
      if (companyData.io) {
        companyData.io.to(`empresa-${empresaId}`).emit('whatsapp:authenticated', {
          status: 'authenticated',
          empresaId: empresaId
        });
      }
    });

    // Pronto
    client.on('ready', async () => {
      const info = client.info;
      console.log(`✅ WhatsApp conectado para empresa ${empresaId}: ${info.pushname}`);
      
      companyData.status = 'connected';
      companyData.info = info;
      companyData.qrCode = null;
      
      // Salvar/atualizar canal no banco
      await this.saveChannel(empresaId, info);
      
      if (companyData.io) {
        companyData.io.to(`empresa-${empresaId}`).emit('whatsapp:ready', {
          status: 'connected',
          info: {
            name: info.pushname,
            number: info.wid.user,
            platform: info.platform
          },
          empresaId: empresaId
        });
      }

      // Registrar log
      await this.logActivity(empresaId, 'whatsapp_connected', {
        number: info.wid.user,
        name: info.pushname
      });
    });

    // Mensagem recebida
    client.on('message', async (msg) => {
      await this.handleIncomingMessage(msg, empresaId, companyData.config);
    });

    // Desconectado
    client.on('disconnected', async (reason) => {
      console.log(`📵 WhatsApp desconectado para empresa ${empresaId}: ${reason}`);
      
      companyData.status = 'disconnected';
      companyData.info = null;
      
      // Atualizar status no banco
      await this.db.query(`
        UPDATE "maya-crm".canais_integracao
        SET conectado = false
        WHERE empresa_id = :empresaId
        AND tipo = 'whatsapp'
      `, {
        replacements: { empresaId }
      });
      
      if (companyData.io) {
        companyData.io.to(`empresa-${empresaId}`).emit('whatsapp:disconnected', {
          status: 'disconnected',
          reason: reason,
          empresaId: empresaId
        });
      }

      // Limpar cliente
      this.clients.delete(empresaId);
    });

    // Erro
    client.on('auth_failure', async (msg) => {
      console.error(`❌ Falha auth WhatsApp empresa ${empresaId}: ${msg}`);
      
      companyData.status = 'auth_failure';
      
      // Limpar sessão corrompida
      const LocalAuth = require('whatsapp-web.js').LocalAuth;
      const fs = require('fs').promises;
      const path = require('path');
      
      try {
        const sessionPath = path.join('./whatsapp-sessions', `empresa-${empresaId}`);
        await fs.rmdir(sessionPath, { recursive: true });
        console.log(`🗑️ Sessão limpa para empresa ${empresaId}`);
      } catch (error) {
        console.error('Erro ao limpar sessão:', error);
      }
      
      this.clients.delete(empresaId);
    });
  }

  // ============================================
  // PROCESSAMENTO DE MENSAGENS COM BOT CUSTOMIZADO
  // ============================================

  async handleIncomingMessage(msg, empresaId, empresaConfig) {
    try {
      const chat = await msg.getChat();
      const contact = await msg.getContact();
      
      if (chat.isGroup) return; // Ignorar grupos por enquanto
      
      const whatsappNumber = contact.id.user;
      const contactName = contact.pushname || contact.name || whatsappNumber;
      const messageContent = msg.body;
      
      console.log(`📩 [Empresa ${empresaId}] Nova mensagem de ${contactName}: ${messageContent}`);
      
      // 1. Buscar ou criar contato
      const contatoId = await this.findOrCreateContact(empresaId, whatsappNumber, contactName);
      
      // 2. Buscar ou criar conversa
      const conversaId = await this.findOrCreateConversation(empresaId, contatoId);
      
      // 3. Salvar mensagem
      await this.saveMessage(conversaId, contatoId, messageContent, msg);
      
      // 4. Processar com bot customizado da empresa
      await this.processWithBot(msg, empresaId, empresaConfig, contatoId, conversaId);
      
      // 5. Emitir eventos
      const companyData = this.clients.get(empresaId);
      if (companyData?.io) {
        companyData.io.to(`empresa-${empresaId}`).emit('nova-mensagem', {
          conversaId: conversaId,
          contatoId: contatoId,
          mensagem: {
            text: messageContent,
            sender: 'contact',
            contactName: contactName,
            contactNumber: whatsappNumber
          }
        });
      }
      
    } catch (error) {
      console.error(`Erro ao processar mensagem para empresa ${empresaId}:`, error);
    }
  }

  async processWithBot(msg, empresaId, config, contatoId, conversaId) {
    // Verificar se bot está ativo para esta empresa
    const [botConfig] = await this.db.query(`
      SELECT 
        bot_ativo,
        bot_mensagem_inicial,
        bot_menu_opcoes,
        bot_respostas,
        bot_delay_resposta,
        bot_transferir_atendente_palavras
      FROM "maya-crm".configuracoes_bot
      WHERE empresa_id = :empresaId
    `, {
      replacements: { empresaId }
    });

    if (!botConfig[0]?.bot_ativo) {
      // Se não tem bot, enviar resposta padrão se configurado
      if (config.resposta_automatica_ativa) {
        await this.sendDefaultReply(msg, config, conversaId);
      }
      return;
    }

    const bot = botConfig[0];
    const messageText = msg.body.toLowerCase();

    // Verificar se deve transferir para atendente
    const transferWords = bot.bot_transferir_atendente_palavras || ['atendente', 'humano', 'pessoa', 'ajuda'];
    if (transferWords.some(word => messageText.includes(word))) {
      await msg.reply('🤝 Transferindo para um atendente humano...');
      
      // Marcar conversa para atendimento humano
      await this.db.query(`
        UPDATE "maya-crm".conversas
        SET 
          bot_ativo = false,
          status = 'aguardando_atendente'
        WHERE id = :conversaId
      `, {
        replacements: { conversaId }
      });
      
      return;
    }

    // Processar menu de opções
    if (bot.bot_menu_opcoes) {
      const menu = JSON.parse(bot.bot_menu_opcoes);
      
      // Verificar se é primeira mensagem
      const [messageCount] = await this.db.query(`
        SELECT COUNT(*) as total
        FROM "maya-crm".mensagens
        WHERE conversa_id = :conversaId
      `, {
        replacements: { conversaId }
      });

      if (messageCount[0].total === 1) {
        // Enviar mensagem inicial + menu
        const menuText = bot.bot_mensagem_inicial + '\n\n' + 
          menu.map((opt, idx) => `${idx + 1}. ${opt.texto}`).join('\n');
        
        await msg.reply(menuText);
        
        // Salvar estado do bot
        await this.db.query(`
          UPDATE "maya-crm".conversas
          SET 
            bot_estado = 'menu_principal',
            bot_contexto = :contexto
          WHERE id = :conversaId
        `, {
          replacements: { 
            conversaId,
            contexto: JSON.stringify({ step: 'menu' })
          }
        });
      } else {
        // Processar resposta do menu
        const optionNumber = parseInt(messageText);
        if (optionNumber > 0 && optionNumber <= menu.length) {
          const selectedOption = menu[optionNumber - 1];
          
          // Responder com a ação da opção
          await msg.reply(selectedOption.resposta || 'Opção selecionada: ' + selectedOption.texto);
          
          // Executar ação se configurada
          if (selectedOption.acao === 'transferir_atendente') {
            await this.db.query(`
              UPDATE "maya-crm".conversas
              SET bot_ativo = false, status = 'aguardando_atendente'
              WHERE id = :conversaId
            `, {
              replacements: { conversaId }
            });
          }
        }
      }
    }

    // Processar respostas automáticas customizadas
    if (bot.bot_respostas) {
      const respostas = JSON.parse(bot.bot_respostas);
      
      for (const resposta of respostas) {
        if (resposta.palavras_chave.some(palavra => messageText.includes(palavra))) {
          // Delay configurável
          if (bot.bot_delay_resposta) {
            await new Promise(resolve => setTimeout(resolve, bot.bot_delay_resposta * 1000));
          }
          
          await msg.reply(resposta.resposta);
          
          // Salvar resposta no banco
          await this.saveMessage(conversaId, null, resposta.resposta, null, 'bot');
          break;
        }
      }
    }
  }

  async sendDefaultReply(msg, config, conversaId) {
    const hour = new Date().getHours();
    const inicio = parseInt(config.horario_atendimento_inicio) || 9;
    const fim = parseInt(config.horario_atendimento_fim) || 18;
    
    let replyMessage = '';
    
    if (hour >= inicio && hour < fim) {
      replyMessage = config.mensagem_boas_vindas || 
        'Olá! Obrigado por entrar em contato. Um de nossos atendentes responderá em breve.';
    } else {
      replyMessage = config.mensagem_fora_horario || 
        `Olá! Nosso horário de atendimento é das ${inicio}h às ${fim}h. Responderemos assim que possível.`;
    }
    
    await msg.reply(replyMessage);
    
    // Salvar resposta
    await this.saveMessage(conversaId, null, replyMessage, null, 'bot');
  }

  // ============================================
  // FUNÇÕES AUXILIARES
  // ============================================

  async findOrCreateContact(empresaId, whatsappNumber, contactName) {
    const [contatos] = await this.db.query(`
      SELECT id FROM "maya-crm".contatos 
      WHERE whatsapp = :whatsapp 
      AND empresa_id = :empresaId
      LIMIT 1
    `, {
      replacements: { whatsapp: whatsappNumber, empresaId }
    });
    
    if (contatos.length > 0) {
      return contatos[0].id;
    }
    
    const [novoContato] = await this.db.query(`
      INSERT INTO "maya-crm".contatos 
      (empresa_id, nome, whatsapp, telefone, origem, score, ativo)
      VALUES 
      (:empresaId, :nome, :whatsapp, :whatsapp, 'whatsapp', 50, true)
      RETURNING id
    `, {
      replacements: {
        empresaId,
        nome: contactName,
        whatsapp: whatsappNumber
      }
    });
    
    return novoContato[0].id;
  }

  async findOrCreateConversation(empresaId, contatoId) {
    const [conversas] = await this.db.query(`
      SELECT id FROM "maya-crm".conversas 
      WHERE contato_id = :contatoId
      AND empresa_id = :empresaId
      AND status != 'fechada'
      LIMIT 1
    `, {
      replacements: { contatoId, empresaId }
    });
    
    if (conversas.length > 0) {
      return conversas[0].id;
    }
    
    const [novaConversa] = await this.db.query(`
      INSERT INTO "maya-crm".conversas 
      (empresa_id, contato_id, canal_tipo, status, bot_ativo, primeira_mensagem_em, ultima_mensagem_em)
      VALUES 
      (:empresaId, :contatoId, 'whatsapp', 'aberta', true, NOW(), NOW())
      RETURNING id
    `, {
      replacements: { empresaId, contatoId }
    });
    
    return novaConversa[0].id;
  }

  async saveMessage(conversaId, contatoId, content, msg, senderType = 'contato') {
    await this.db.query(`
      INSERT INTO "maya-crm".mensagens 
      (conversa_id, remetente_tipo, remetente_id, conteudo, tipo_conteudo, metadata, lida, enviada)
      VALUES 
      (:conversaId, :senderType, :contatoId, :content, :tipo, :metadata, :lida, true)
    `, {
      replacements: {
        conversaId,
        senderType,
        contatoId,
        content,
        tipo: msg?.type || 'chat',
        metadata: msg ? JSON.stringify({
          whatsapp_id: msg.id?.id,
          timestamp: msg.timestamp,
          has_media: msg.hasMedia
        }) : '{}',
        lida: senderType === 'bot'
      }
    });
    
    // Atualizar última mensagem
    await this.db.query(`
      UPDATE "maya-crm".conversas 
      SET ultima_mensagem_em = NOW()
      WHERE id = :conversaId
    `, {
      replacements: { conversaId }
    });
  }

  async saveChannel(empresaId, info) {
    await this.db.query(`
      INSERT INTO "maya-crm".canais_integracao 
      (empresa_id, tipo, nome, telefone, configuracoes, ativo, conectado)
      VALUES 
      (:empresaId, 'whatsapp', :nome, :telefone, :config, true, true)
      ON CONFLICT (empresa_id, tipo) 
      DO UPDATE SET
        nome = :nome,
        telefone = :telefone,
        configuracoes = :config,
        conectado = true,
        ultima_sincronizacao = NOW()
    `, {
      replacements: {
        empresaId,
        nome: `WhatsApp - ${info.pushname}`,
        telefone: info.wid.user,
        config: JSON.stringify({
          phone: info.wid.user,
          name: info.pushname,
          platform: info.platform
        })
      }
    });
  }

  async logActivity(empresaId, type, data) {
    await this.db.query(`
      INSERT INTO "maya-crm".logs_atividades
      (empresa_id, tipo, dados, criado_em)
      VALUES
      (:empresaId, :type, :data, NOW())
    `, {
      replacements: {
        empresaId,
        type,
        data: JSON.stringify(data)
      }
    }).catch(err => console.log('Erro ao salvar log:', err));
  }

  // ============================================
  // MÉTODOS PÚBLICOS
  // ============================================

  async sendMessage(empresaId, number, message) {
    const companyData = this.clients.get(empresaId);
    
    if (!companyData || companyData.status !== 'connected') {
      throw new Error('WhatsApp não está conectado para esta empresa');
    }
    
    const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
    return await companyData.client.sendMessage(chatId, message);
  }

  async disconnect(empresaId) {
    const companyData = this.clients.get(empresaId);
    
    if (!companyData) {
      return { success: false, message: 'WhatsApp não está conectado' };
    }
    
    try {
      await companyData.client.logout();
      await companyData.client.destroy();
      this.clients.delete(empresaId);
      
      return { success: true, message: 'WhatsApp desconectado' };
    } catch (error) {
      console.error('Erro ao desconectar:', error);
      return { success: false, error: error.message };
    }
  }

  getStatus(empresaId) {
    const companyData = this.clients.get(empresaId);
    
    if (!companyData) {
      return {
        connected: false,
        status: 'not_initialized'
      };
    }
    
    return {
      connected: companyData.status === 'connected',
      status: companyData.status,
      qrCode: companyData.qrCode,
      info: companyData.info
    };
  }

  getAllConnections() {
    const connections = [];
    
    for (const [empresaId, data] of this.clients) {
      connections.push({
        empresaId,
        status: data.status,
        connected: data.status === 'connected',
        number: data.info?.wid?.user,
        name: data.info?.pushname
      });
    }
    
    return connections;
  }
}

// Singleton
module.exports = new WhatsAppMultiTenant();