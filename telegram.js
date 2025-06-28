// telegram.js
const { bot, activeClients, userStates } = require('./lib/botConfig');
const { reconnectAllSessions } = require('./lib/connectionManager');

// Import all handlers to register commands and callback queries
require('./lib/botHandlers');

// Run automatic session reconnection on startup
reconnectAllSessions(activeClients, userStates, bot);

