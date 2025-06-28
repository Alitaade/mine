// utils/logger.js
const pino = require('pino');
const config = require('../config.js');

module.exports = pino({
    level: config.logging.level || 'info',
    transport: {
        target: 'pino/file',  // Use built-in file transport instead of pino-pretty
        options: { destination: 1 } // Output to stdout
    }
});