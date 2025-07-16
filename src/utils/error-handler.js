const logger = require('./logger');

class ErrorHandler {
    constructor(client, botInstance) {
        this.client = client;
        this.botInstance = botInstance; // Referência à instância principal do bot para reinicialização
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
    }

    setupErrorHandlers() {
        this.client.on('disconnected', (reason) => {
            logger.warn(`Cliente desconectado: ${reason}. Tentando reconectar...`);
            this.handleDisconnection();
        });

        this.client.on('auth_failure', (msg) => {
            logger.error(`FALHA NA AUTENTICAÇÃO: ${msg}. O bot será encerrado.`);
            logger.error('Delete a pasta .wwebjs_auth e tente novamente.');
            process.exit(1);
        });

        this.client.on('error', (error) => {
            logger.error('Erro geral no cliente do WhatsApp:', error);
        });
    }

    async handleDisconnection() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectAttempts * 5000; // Aumenta o delay a cada tentativa
            logger.info(`Tentativa de reconexão ${this.reconnectAttempts}/${this.maxReconnectAttempts} em ${delay / 1000}s.`);
            
            setTimeout(async () => {
                try {
                    await this.botInstance.initialize();
                    logger.info('Reconexão bem-sucedida!');
                    this.reconnectAttempts = 0; // Reseta as tentativas após sucesso
                } catch (error) {
                    logger.error(`Falha ao reconectar na tentativa ${this.reconnectAttempts}:`, error);
                }
            }, delay);

        } else {
            logger.error(`Número máximo de tentativas de reconexão atingido. Verifique sua conexão e reinicie o bot manualmente.`);
            process.exit(1);
        }
    }
}

module.exports = ErrorHandler;
