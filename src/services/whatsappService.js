// backend/src/services/whatsappService.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');

class WhatsAppService {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.qrCode = null;
    this.sessionInfo = null;
    this.io = null;
    this.empresaId = process.env.DEFAULT_EMPRESA_ID || '00000000-0000-0000-0000-000000000001';
    this.canalId = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  initialize(io) {
    console.log('🔄 Inicializando WhatsApp Service...');
    this.io = io;
    
    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: `maya-crm-${this.empresaId}`,
        dataPath: './whatsapp-sessions'
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ]
      },
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
      }
    });

    this.setupEventHandlers();
    this.client.initialize().catch(err => {
      console.error('❌ Erro ao inicializar WhatsApp:', err);
    });
  }

  setupEventHandlers() {
    // QR Code gerado
    this.client.on('qr', async (qr) => {
      this.qrCode = qr;
      this.isReady = false;
      
      console.log('📱 QR Code gerado!');
      
      // Mostrar no terminal
      qrcodeTerminal.generate(qr, { small: true });
      
      // Gerar imagem base64
      try {
        const qrDataUrl = await qrcode.toDataURL(qr);
        
        // Emitir via Socket.io
        if (this.io) {
          this.io.emit('whatsapp:qr', {
            qr: qrDataUrl,
            status: 'waiting'
          });
        }
      } catch (error) {
        console.error('Erro ao gerar QR Code base64:', error);
      }
    });

    // Autenticado com sucesso
    this.client.on('authenticated', () => {
      console.log('✅ WhatsApp autenticado com sucesso');
      this.qrCode = null;
      
      if (this.io) {
        this.io.emit('whatsapp:authenticated', {
          status: 'authenticated'
        });
      }
    });

    // Cliente pronto
    this.client.on('ready', async () => {
      this.isReady = true;
      this.sessionInfo = this.client.info;
      
      console.log(`✅ WhatsApp conectado: ${this.sessionInfo.pushname}`);
      console.log(`📱 Número: ${this.sessionInfo.wid.user}`);
      
      // Salvar ou atualizar canal no banco
      await this.saveChannel();
      
      if (this.io) {
        this.io.emit('whatsapp:ready', {
          status: 'connected',
          info: {
            name: this.sessionInfo.pushname,
            number: this.sessionInfo.wid.user,
            platform: this.sessionInfo.platform
          }
        });
      }
    });

    // Mensagem recebida
    this.client.on('message', async (msg) => {
      try {
        await this.handleIncomingMessage(msg);
      } catch (error) {
        console.error('Erro ao processar mensagem:', error);
      }
    });

    // Mensagem enviada (pelo próprio usuário em outro dispositivo)
    this.client.on('message_create', async (msg) => {
      if (msg.fromMe && !msg.from.includes('@c.us')) {
        await this.handleOutgoingMessage(msg);
      }
    });

    // Desconectado
    this.client.on('disconnected', (reason) => {
      this.isReady = false;
      console.log(`📵 WhatsApp desconectado: ${reason}`);
      
      if (this.io) {
        this.io.emit('whatsapp:disconnected', {
          status: 'disconnected',
          reason: reason
        });
      }
      
      this.handleReconnection();
    });

    // Erro de autenticação
    this.client.on('auth_failure', (msg) => {
      console.error(`❌ Falha na autenticação WhatsApp: ${msg}`);
      
      if (this.io) {
        this.io.emit('whatsapp:error', {
          status: 'auth_failure',
          message: 'Falha na autenticação. Delete a sessão e tente novamente.'
        });
      }
    });

    // Loading screen
    this.client.on('loading_screen', (percent, message) => {
      console.log(`⏳ Carregando: ${percent}% - ${message}`);
      
      if (this.io) {
        this.io.emit('whatsapp:loading', {
          percent: percent,
          message: message
        });
      }
    });
  }

// Substituir apenas o método handleIncomingMessage no arquivo backend/src/services/whatsappService.js

async handleIncomingMessage(msg) {
  try {
    const chat = await msg.getChat();
    const contact = await msg.getContact();
    
    // Extrair informações
    const whatsappNumber = contact.id.user;
    const contactName = contact.pushname || contact.name || whatsappNumber;
    const messageContent = msg.body;
    const isGroup = chat.isGroup;
    
    // Ignorar mensagens de grupo por enquanto
    if (isGroup) return;
    
    console.log(`📩 Nova mensagem de ${contactName} (${whatsappNumber}): ${messageContent}`);
    
    // Conectar ao banco
    const { Sequelize } = require('sequelize');
    const sequelize = new Sequelize(process.env.DATABASE_URL || 
      `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`, {
      dialect: 'postgres',
      logging: false
    });
    
    const empresaId = this.empresaId;
    
    // 1. Buscar ou criar contato
    let [contatos] = await sequelize.query(`
      SELECT id, nome, score FROM "maya-crm".contatos 
      WHERE whatsapp = :whatsapp 
      AND empresa_id = :empresaId
      LIMIT 1
    `, {
      replacements: { 
        whatsapp: whatsappNumber,
        empresaId 
      }
    });
    
    let contatoId;
    
    if (contatos.length === 0) {
      // Criar novo contato
      console.log('Criando novo contato...');
      const [novoContato] = await sequelize.query(`
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
      
      contatoId = novoContato[0].id;
      
      // Criar negócio na primeira etapa
      const [[primeiraEtapa]] = await sequelize.query(`
        SELECT id FROM "maya-crm".pipeline_etapas 
        WHERE empresa_id = :empresaId 
        AND ordem = 1
        LIMIT 1
      `, {
        replacements: { empresaId }
      });
      
      if (primeiraEtapa) {
        await sequelize.query(`
          INSERT INTO "maya-crm".negocios 
          (empresa_id, contato_id, etapa_id, titulo, valor, probabilidade, origem)
          VALUES 
          (:empresaId, :contatoId, :etapaId, :titulo, 0, 25, 'whatsapp')
        `, {
          replacements: {
            empresaId,
            contatoId,
            etapaId: primeiraEtapa.id,
            titulo: `Lead WhatsApp - ${contactName}`
          }
        });
      }
    } else {
      contatoId = contatos[0].id;
      
      // Aumentar score do contato
      await sequelize.query(`
        UPDATE "maya-crm".contatos 
        SET score = LEAST(score + 5, 100)
        WHERE id = :contatoId
      `, {
        replacements: { contatoId }
      });
    }
    
    // 2. Buscar ou criar conversa
    let [conversas] = await sequelize.query(`
      SELECT id, bot_ativo FROM "maya-crm".conversas 
      WHERE contato_id = :contatoId
      AND empresa_id = :empresaId
      AND canal_tipo = 'whatsapp'
      AND status != 'fechada'
      LIMIT 1
    `, {
      replacements: { 
        contatoId,
        empresaId 
      }
    });
    
    let conversaId;
    let conversaBotAtivo = true; // Por padrão, bot ativo para novas conversas
    
    if (conversas.length === 0) {
      // Criar nova conversa
      console.log('Criando nova conversa...');
      const [novaConversa] = await sequelize.query(`
        INSERT INTO "maya-crm".conversas 
        (empresa_id, contato_id, canal_id, canal_tipo, status, bot_ativo, primeira_mensagem_em, ultima_mensagem_em)
        VALUES 
        (:empresaId, :contatoId, :canalId, 'whatsapp', 'aberta', true, NOW(), NOW())
        RETURNING id
      `, {
        replacements: {
          empresaId,
          contatoId,
          canalId: this.canalId
        }
      });
      
      conversaId = novaConversa[0].id;
    } else {
      conversaId = conversas[0].id;
      conversaBotAtivo = conversas[0].bot_ativo;
      
      // Atualizar última mensagem
      await sequelize.query(`
        UPDATE "maya-crm".conversas 
        SET ultima_mensagem_em = NOW(),
            status = CASE 
              WHEN status = 'fechada' THEN 'aberta'
              ELSE status 
            END
        WHERE id = :conversaId
      `, {
        replacements: { conversaId }
      });
    }
    
    // 3. Salvar mensagem
    console.log('Salvando mensagem...');
    const [novaMensagem] = await sequelize.query(`
      INSERT INTO "maya-crm".mensagens 
      (conversa_id, remetente_tipo, remetente_id, conteudo, tipo_conteudo, metadata, lida, enviada)
      VALUES 
      (:conversaId, 'contato', :contatoId, :conteudo, :tipo, :metadata, false, true)
      RETURNING id, criado_em
    `, {
      replacements: {
        conversaId,
        contatoId,
        conteudo: messageContent,
        tipo: msg.type || 'chat',
        metadata: JSON.stringify({
          whatsapp_id: msg.id.id,
          timestamp: msg.timestamp,
          has_media: msg.hasMedia,
          from: whatsappNumber
        })
      }
    });
    
    console.log(`✅ Mensagem salva com ID: ${novaMensagem[0].id}`);
    
    // 4. PROCESSAR COM BOT SE ATIVO
    if (conversaBotAtivo) {
      console.log('🤖 Processando com bot...');
      
      // Buscar configurações do bot
      const [botConfig] = await sequelize.query(`
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
      
      if (botConfig[0]?.bot_ativo) {
        const bot = botConfig[0];
        const messageTextLower = messageContent.toLowerCase();
        
        // Verificar se deve transferir para atendente
        let transferWords = ['atendente', 'humano', 'pessoa', 'ajuda'];
        try {
          if (bot.bot_transferir_atendente_palavras) {
            transferWords = JSON.parse(bot.bot_transferir_atendente_palavras);
          }
        } catch (e) {}
        
        if (transferWords.some(word => messageTextLower.includes(word))) {
          console.log('🤝 Transferindo para atendente...');
          
          await msg.reply('🤝 Ok! Vou chamar um atendente para você. Aguarde um momento...');
          
          // Desativar bot para esta conversa
          await sequelize.query(`
            UPDATE "maya-crm".conversas
            SET bot_ativo = false, status = 'aguardando_atendente'
            WHERE id = :conversaId
          `, {
            replacements: { conversaId }
          });
          
          // Salvar resposta do bot
          await sequelize.query(`
            INSERT INTO "maya-crm".mensagens 
            (conversa_id, remetente_tipo, conteudo, tipo_conteudo, lida, enviada)
            VALUES 
            (:conversaId, 'bot', '🤝 Ok! Vou chamar um atendente para você. Aguarde um momento...', 'chat', true, true)
          `, {
            replacements: { conversaId }
          });
          
        } else {
          // Verificar se é primeira mensagem da conversa
          const [messageCount] = await sequelize.query(`
            SELECT COUNT(*) as total
            FROM "maya-crm".mensagens
            WHERE conversa_id = :conversaId
            AND remetente_tipo = 'contato'
          `, {
            replacements: { conversaId }
          });
          
          let botResponse = null;
          
          if (messageCount[0].total === 1 && bot.bot_mensagem_inicial) {
            // Primeira mensagem - enviar mensagem inicial
            botResponse = bot.bot_mensagem_inicial;
            
            // Se tem menu, adicionar
            if (bot.bot_menu_opcoes) {
              try {
                const menu = JSON.parse(bot.bot_menu_opcoes);
                if (menu.length > 0) {
                  botResponse += '\n\nEscolha uma opção:\n';
                  menu.forEach((opt, idx) => {
                    botResponse += `${idx + 1}. ${opt.texto}\n`;
                  });
                }
              } catch (e) {}
            }
          } else {
            // Verificar respostas automáticas
            if (bot.bot_respostas) {
              try {
                const respostas = JSON.parse(bot.bot_respostas);
                
                for (const resposta of respostas) {
                  if (resposta.palavras_chave && resposta.palavras_chave.some(palavra => 
                    messageTextLower.includes(palavra.toLowerCase())
                  )) {
                    botResponse = resposta.resposta;
                    break;
                  }
                }
              } catch (e) {}
            }
            
            // Verificar se é número do menu
            const numeroOpcao = parseInt(messageContent);
            if (!isNaN(numeroOpcao) && bot.bot_menu_opcoes) {
              try {
                const menu = JSON.parse(bot.bot_menu_opcoes);
                if (numeroOpcao > 0 && numeroOpcao <= menu.length) {
                  const opcaoSelecionada = menu[numeroOpcao - 1];
                  botResponse = opcaoSelecionada.resposta || `Você escolheu: ${opcaoSelecionada.texto}`;
                  
                  // Se a ação é transferir para atendente
                  if (opcaoSelecionada.acao === 'transferir_atendente') {
                    await sequelize.query(`
                      UPDATE "maya-crm".conversas
                      SET bot_ativo = false, status = 'aguardando_atendente'
                      WHERE id = :conversaId
                    `, {
                      replacements: { conversaId }
                    });
                  }
                }
              } catch (e) {}
            }
          }
          
          // Enviar resposta se houver
          if (botResponse) {
            // Delay configurável
            const delay = bot.bot_delay_resposta || 1;
            await new Promise(resolve => setTimeout(resolve, delay * 1000));
            
            console.log(`🤖 Bot respondendo: ${botResponse.substring(0, 50)}...`);
            await msg.reply(botResponse);
            
            // Salvar resposta do bot no banco
            await sequelize.query(`
              INSERT INTO "maya-crm".mensagens 
              (conversa_id, remetente_tipo, conteudo, tipo_conteudo, lida, enviada)
              VALUES 
              (:conversaId, 'bot', :conteudo, 'chat', true, true)
            `, {
              replacements: {
                conversaId,
                conteudo: botResponse
              }
            });
          }
        }
      } else {
        console.log('⚠️ Bot não está ativo para esta empresa');
      }
    } else {
      console.log('ℹ️ Bot desativado para esta conversa (atendimento humano)');
    }
    
    // 5. Emitir evento via Socket.io para atualizar o frontend
    if (this.io) {
      // Evento para nova mensagem
      this.io.emit('nova-mensagem', {
        conversaId: conversaId,
        contatoId: contatoId,
        mensagem: {
          id: novaMensagem[0].id,
          text: messageContent,
          sender: 'contact',
          time: novaMensagem[0].criado_em,
          contactName: contactName,
          contactNumber: whatsappNumber
        }
      });
      
      // Evento para atualizar lista de conversas
      this.io.emit('conversation-updated', {
        id: conversaId,
        lastMessage: messageContent,
        lastMessageTime: new Date(),
        unreadCount: 1,
        contact: {
          id: contatoId,
          name: contactName,
          phone: whatsappNumber
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Erro ao processar mensagem:', error);
  }
}

  async handleOutgoingMessage(msg) {
    try {
      // Salvar mensagens enviadas pelo próprio usuário em outro dispositivo
      const chat = await msg.getChat();
      if (chat.isGroup) return;
      
      const whatsappNumber = chat.id.user;
      const messageContent = msg.body;
      
      // Conectar ao banco
      const { Sequelize } = require('sequelize');
      const sequelize = new Sequelize(process.env.DATABASE_URL || 
        `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`, {
        dialect: 'postgres',
        logging: false
      });
      
      // Buscar contato
      const [contatos] = await sequelize.query(`
        SELECT id FROM "maya-crm".contatos 
        WHERE whatsapp = :whatsapp 
        AND empresa_id = :empresaId
        LIMIT 1
      `, {
        replacements: { 
          whatsapp: whatsappNumber,
          empresaId: this.empresaId 
        }
      });
      
      if (contatos.length === 0) return;
      
      const contatoId = contatos[0].id;
      
      // Buscar conversa
      const [conversas] = await sequelize.query(`
        SELECT id FROM "maya-crm".conversas 
        WHERE contato_id = :contatoId
        AND empresa_id = :empresaId
        AND canal_tipo = 'whatsapp'
        AND status != 'fechada'
        LIMIT 1
      `, {
        replacements: { 
          contatoId,
          empresaId: this.empresaId 
        }
      });
      
      if (conversas.length === 0) return;
      
      const conversaId = conversas[0].id;
      
      // Salvar mensagem
      await sequelize.query(`
        INSERT INTO "maya-crm".mensagens 
        (conversa_id, remetente_tipo, conteudo, tipo_conteudo, metadata, lida, enviada)
        VALUES 
        (:conversaId, 'usuario', :conteudo, :tipo, :metadata, true, true)
      `, {
        replacements: {
          conversaId,
          conteudo: messageContent,
          tipo: msg.type || 'chat',
          metadata: JSON.stringify({
            whatsapp_id: msg.id.id,
            timestamp: msg.timestamp,
            from_other_device: true
          })
        }
      });
      
      console.log('📤 Mensagem enviada de outro dispositivo salva');
      
    } catch (error) {
      console.error('Erro ao salvar mensagem enviada:', error);
    }
  }

  async sendMessage(whatsappNumber, message, conversaId = null) {
    if (!this.isReady) {
      throw new Error('WhatsApp não está conectado');
    }
    
    try {
      // Formatar número
      const chatId = whatsappNumber.includes('@c.us') 
        ? whatsappNumber 
        : `${whatsappNumber}@c.us`;
      
      // Enviar mensagem
      const result = await this.client.sendMessage(chatId, message);
      
      console.log(`✉️ Mensagem enviada para ${whatsappNumber}`);
      
      // Salvar no banco se tiver conversaId
      if (conversaId) {
        const { Sequelize } = require('sequelize');
        const sequelize = new Sequelize(process.env.DATABASE_URL || 
          `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`, {
          dialect: 'postgres',
          logging: false
        });
        
        await sequelize.query(`
          UPDATE "maya-crm".mensagens 
          SET metadata = jsonb_set(
            COALESCE(metadata, '{}')::jsonb, 
            '{whatsapp_id}', 
            :whatsappId::jsonb
          ),
          enviada = true
          WHERE conversa_id = :conversaId
          AND remetente_tipo = 'usuario'
          AND enviada = false
          ORDER BY criado_em DESC
          LIMIT 1
        `, {
          replacements: {
            conversaId,
            whatsappId: JSON.stringify(result.id.id)
          }
        });
      }
      
      return result;
    } catch (error) {
      console.error('Erro ao enviar mensagem WhatsApp:', error);
      throw error;
    }
  }

  async saveChannel() {
    try {
      const { Sequelize } = require('sequelize');
      const sequelize = new Sequelize(process.env.DATABASE_URL || 
        `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`, {
        dialect: 'postgres',
        logging: false
      });
      
      // Verificar se canal existe
      const [canais] = await sequelize.query(`
        SELECT id FROM "maya-crm".canais_integracao 
        WHERE empresa_id = :empresaId
        AND tipo = 'whatsapp'
        LIMIT 1
      `, {
        replacements: { empresaId: this.empresaId }
      });
      
      const configuracoes = JSON.stringify({
        phone: this.sessionInfo.wid.user,
        name: this.sessionInfo.pushname,
        platform: this.sessionInfo.platform,
        connected_at: new Date()
      });
      
      if (canais.length > 0) {
        // Atualizar canal existente
        this.canalId = canais[0].id;
        
        await sequelize.query(`
          UPDATE "maya-crm".canais_integracao 
          SET 
            nome = :nome,
            telefone = :telefone,
            configuracoes = :configuracoes,
            ativo = true,
            conectado = true,
            ultima_sincronizacao = NOW()
          WHERE id = :canalId
        `, {
          replacements: {
            canalId: this.canalId,
            nome: `WhatsApp - ${this.sessionInfo.pushname}`,
            telefone: this.sessionInfo.wid.user,
            configuracoes
          }
        });
      } else {
        // Criar novo canal
        const [novoCanal] = await sequelize.query(`
          INSERT INTO "maya-crm".canais_integracao 
          (empresa_id, tipo, nome, telefone, configuracoes, ativo, conectado, ultima_sincronizacao)
          VALUES 
          (:empresaId, 'whatsapp', :nome, :telefone, :configuracoes, true, true, NOW())
          RETURNING id
        `, {
          replacements: {
            empresaId: this.empresaId,
            nome: `WhatsApp - ${this.sessionInfo.pushname}`,
            telefone: this.sessionInfo.wid.user,
            configuracoes
          }
        });
        
        this.canalId = novoCanal[0].id;
      }
      
      console.log(`✅ Canal WhatsApp salvo: ${this.canalId}`);
      
    } catch (error) {
      console.error('Erro ao salvar canal:', error);
    }
  }

  async handleReconnection() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectAttempts * 5000;
      
      console.log(`🔄 Tentando reconectar (${this.reconnectAttempts}/${this.maxReconnectAttempts}) em ${delay/1000}s...`);
      
      setTimeout(() => {
        this.client.initialize();
      }, delay);
    } else {
      console.error('❌ Máximo de tentativas de reconexão atingido');
      
      // Marcar canal como desconectado
      if (this.canalId) {
        const { Sequelize } = require('sequelize');
        const sequelize = new Sequelize(process.env.DATABASE_URL || 
          `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`, {
          dialect: 'postgres',
          logging: false
        });
        
        sequelize.query(`
          UPDATE "maya-crm".canais_integracao 
          SET conectado = false 
          WHERE id = :canalId
        `, {
          replacements: { canalId: this.canalId }
        }).catch(err => console.error('Erro ao atualizar status do canal:', err));
      }
    }
  }

  async disconnect() {
    if (this.client) {
      console.log('🔌 Desconectando WhatsApp...');
      
      try {
        await this.client.logout();
        await this.client.destroy();
      } catch (error) {
        console.error('Erro ao desconectar:', error);
      }
      
      this.isReady = false;
      this.qrCode = null;
      
      // Marcar canal como desconectado
      if (this.canalId) {
        const { Sequelize } = require('sequelize');
        const sequelize = new Sequelize(process.env.DATABASE_URL || 
          `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`, {
          dialect: 'postgres',
          logging: false
        });
        
        await sequelize.query(`
          UPDATE "maya-crm".canais_integracao 
          SET conectado = false 
          WHERE id = :canalId
        `, {
          replacements: { canalId: this.canalId }
        });
      }
      
      console.log('✅ WhatsApp desconectado');
    }
  }

  getStatus() {
    return {
      connected: this.isReady,
      qrCode: this.qrCode,
      hasQR: !!this.qrCode,
      info: this.sessionInfo,
      channelId: this.canalId
    };
  }
}

// Singleton
module.exports = new WhatsAppService();