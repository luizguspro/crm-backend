// backend/src/config/socket.js
// Configuração do Socket.IO (desabilitado por enquanto)

function setupSocketIO(server) {
  console.log('ℹ️  Socket.IO desabilitado temporariamente');
  
  // TODO: Implementar Socket.IO quando necessário
  /*
  const io = require('socket.io')(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true
    }
  });
  
  io.on('connection', (socket) => {
    console.log('Novo cliente conectado:', socket.id);
    
    socket.on('disconnect', () => {
      console.log('Cliente desconectado:', socket.id);
    });
  });
  
  return io;
  */
}

module.exports = setupSocketIO;
