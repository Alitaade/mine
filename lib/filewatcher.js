// fileWatcher.js
const { fs, path, chalk, chokidar, dotenv } = require ('./logs')
require('dotenv').config();
const logger = require('./logger');
const config = require('../config');
const { bot, homeButton } = require('./botConfig');
const SESSION_FOLDER = path.resolve(__dirname, '..', 'session');
const CREDS_FILE = path.resolve(SESSION_FOLDER, 'creds.json');
const ownerNumber = process.env.OWNERNUMBER || 'YOUR_NUMBER';
let debounceTimeouts = {};
// Function to log changes
const logChange = (event, filePath) => {
    const relativePath = path.relative(__dirname, filePath);
    if (event === 'add' || event === 'change' || event === 'addDir') {
        console.log(chalk.green(`[ CHANGE  ] ${filePath}`));
    } else if (event === 'unlink' || event === 'unlinkDir') {
        console.log(chalk.red(`[ DELETE  ] ${filePath}`));
    }
};

const reloadFile = async (filePath) => {
    try {
        const extension = path.extname(filePath).toLowerCase();
        const relativePath = path.relative(__dirname, filePath);

        if (extension === '.env') {
            dotenv.config(); // Reload environment variables
            console.log(chalk.green(`[ ENV RELOADED ] ${relativePath}`));
        } else if (extension === '.js') {
            const modulePath = path.resolve(filePath);

            if (require.cache[modulePath]) {
                delete require.cache[modulePath]; // Clear module cache
                require(modulePath); // Reload the JavaScript module
                console.log(chalk.green(`[ JS MODULE RELOADED ] ${relativePath}`));
            } else {
                console.log(chalk.yellow(`[ JS MODULE NOT IN CACHE ] ${relativePath}`));
            }
        } else if (extension === '.py') {
            console.log(chalk.green(`[ PYTHON FILE CHANGED ] ${relativePath} - Handle accordingly`));
            // Add Python-specific handling if needed
        } else {
            console.log(chalk.blue(`[ SKIPPED ] ${relativePath} (Not supported file type)`));
        }
    } catch (err) {
        console.error(chalk.red(`[ RELOAD ERROR ] ${err.message}`));
    }
};

// Watcher Configuration using fs.watchFile to watch files in a directory
const watchDirectory = (dirPath) => {
    fs.readdirSync(dirPath).forEach(file => {
        const fullPath = path.join(dirPath, file);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
            // Recursively watch subdirectories
            watchDirectory(fullPath);
        } else {
            // Only watch specific files
            if (!fullPath.includes('.npm') && !fullPath.includes('.cache') && !fullPath.includes('node_modules')  && !fullPath.includes('session')  && !fullPath.includes('tmp') && !fullPath.includes('.git')) {
                fs.watchFile(fullPath, { persistent: true }, () => {
                    // Debounce the file changes to prevent multiple reloads
                    if (debounceTimeouts[fullPath]) {
                        clearTimeout(debounceTimeouts[fullPath]);
                    }

                    debounceTimeouts[fullPath] = setTimeout(() => {
                        logChange('change', fullPath); // Log change event
                        reloadFile(fullPath); // Reload the file after debounce
                    }, 500); // Adjust debounce delay if needed (500 ms)
                });
            }
        }
    });
};

// Start watching the current directory
watchDirectory(__dirname);

class StringSession {
  deCrypt(string) {
    if (!string || !string.includes(';;;')) return null;
    try {
      const split = string.split(';;;');
      return JSON.parse(Buffer.from(split.pop(), 'base64').toString('utf-8'));
    } catch (error) {
      logger.error('Error decrypting session string:', error);
      return null;
    }
  }

  createStringSession(dict) {
    return `PAUL;;;${Buffer.from(JSON.stringify(dict)).toString('base64')}`;
  }
}

const Session = new StringSession();

function restoreSessionFromString(sessionString, userId) {
  try {
    const creds = Session.deCrypt(sessionString);
    if (!creds) throw new Error('Invalid session string');
    
    const sessionPath = path.join(config.paths.sessions, userId);
    fs.mkdirSync(sessionPath, { recursive: true });
    fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(creds, null, 2));
    logger.info(`Session restored from string for user ${userId}.`);
    return true;
  } catch (error) {
    logger.error(`Error restoring session for user ${userId}: ${error.message}`);
    return false;
  }
}

async function generateAndSendSessionString(client, chatId, userId) {
  try {
    console.log(client.authState.creds); // Debugging
    if (!client.authState?.creds) throw new Error('Client credentials missing');

    const creds = client.authState.creds;
    if (!creds || typeof creds !== 'object') {
      throw new Error('Invalid session credentials');
    }

    const sessionString = Session.createStringSession(creds);
    try {
      await bot.sendMessage(chatId, `🔑 Your session string:\n\n\`${sessionString}\`\n\nSave this to restore your session later.`, {
        parse_mode: 'Markdown',
        ...homeButton,
      });
    } catch (error) {
      logger.error(`Failed to send session string to user ${userId}:`, error);
    }

    logger.info(`Session string generated and sent for user ${userId}.`);
  } catch (error) {
    logger.error(`Error generating/sending session string for user ${userId}:`, error.message);
    await bot.sendMessage(chatId, '❌ Failed to generate session string. Please try again.', homeButton);
  }
}
module.exports = {
  StringSession,
  Session,
  restoreSessionFromString,
  generateAndSendSessionString,
};