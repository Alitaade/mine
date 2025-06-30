const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const express = require('express');
const dotenv = require('dotenv');
const cron = require('node-cron');
const axios = require('axios');

// Load environment variables
dotenv.config();

/**
 * ================================
 * CONFIGURATION & CONSTANTS
 * ================================
 */
const CONFIG = {
    APP_NAME: process.env.APP_NAME || 'PAUL-MD',
    SESSION_PATH: process.env.SESSION_PATH || './session/creds.json',
    PORT: parseInt(process.env.PORT) || 9699,
    START_METHOD: (process.env.START_METHOD || 'direct').toLowerCase(),
    KEEP_ALIVE_INTERVAL: parseInt(process.env.KEEP_ALIVE_INTERVAL) || 5, // minutes
    MAX_RESTARTS: parseInt(process.env.MAX_RESTARTS) || 7,
    RESTART_DELAY: parseInt(process.env.RESTART_DELAY) || 2000, // milliseconds
    SERVER_TIMEOUT: parseInt(process.env.SERVER_TIMEOUT) || 300000, // 5 minutes
    HEALTH_CHECK_PORT: parseInt(process.env.HEALTH_CHECK_PORT) || CONFIG.PORT,
    NODE_ENV: process.env.NODE_ENV || 'production'
};

const DIRECTORIES = ['tmp', 'XeonMedia', 'lib', 'src', 'session', 'logs'];
const CLEANUP_DIRS = ['.cache', '.npm', 'logs'];

/**
 * ================================
 * UTILITY FUNCTIONS
 * ================================
 */
class Logger {
    static colors = {
        reset: '\x1b[0m',
        bright: '\x1b[1m',
        red: '\x1b[31m',
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        blue: '\x1b[34m',
        magenta: '\x1b[35m',
        cyan: '\x1b[36m',
        white: '\x1b[37m'
    };

    static log(message, color = 'white') {
        const timestamp = new Date().toISOString();
        const colorCode = this.colors[color] || this.colors.white;
        console.log(`${colorCode}[${timestamp}] ${message}${this.colors.reset}`);
    }

    static info(message) { this.log(`ℹ️  ${message}`, 'cyan'); }
    static success(message) { this.log(`✅ ${message}`, 'green'); }
    static warning(message) { this.log(`⚠️  ${message}`, 'yellow'); }
    static error(message) { this.log(`❌ ${message}`, 'red'); }
    static debug(message) { this.log(`🐛 ${message}`, 'magenta'); }
}

class FileManager {
    /**
     * Ensure all required directories exist with proper permissions
     */
    static async ensureDirectories() {
        Logger.info('Setting up required directories...');
        
        const results = await Promise.allSettled(
            DIRECTORIES.map(async (dir) => {
                const fullPath = path.join(__dirname, dir);
                try {
                    await fs.access(fullPath);
                    Logger.debug(`Directory ${dir} exists`);
                } catch {
                    await fs.mkdir(fullPath, { recursive: true });
                    Logger.success(`Created directory ${dir}`);
                }
                await fs.chmod(fullPath, 0o755);
                return dir;
            })
        );

        const failed = results.filter(result => result.status === 'rejected');
        if (failed.length > 0) {
            Logger.error(`Failed to create ${failed.length} directories`);
            throw new Error('Directory setup failed');
        }
        
        Logger.success('All directories configured successfully');
    }

    /**
     * Clean up cache and temporary directories
     */
    static async cleanupDirectories() {
        Logger.info('Cleaning cache directories...');
        
        const results = await Promise.allSettled(
            CLEANUP_DIRS.map(async (dir) => {
                const fullPath = path.join(__dirname, dir);
                try {
                    await fs.rm(fullPath, { recursive: true, force: true });
                    Logger.debug(`Cleaned ${dir}`);
                } catch (err) {
                    if (err.code !== 'ENOENT') {
                        Logger.warning(`Could not clean ${dir}: ${err.message}`);
                    }
                }
                return dir;
            })
        );

        Logger.success('Cache cleanup completed');
    }

    /**
     * Check if main bot file exists
     */
    static async validateBotFile() {
        const mainFile = path.join(__dirname, 'telegram.js');
        try {
            await fs.access(mainFile);
            Logger.success('Bot file (telegram.js) found');
            return mainFile;
        } catch (err) {
            Logger.error('telegram.js not found! Please ensure it exists in the root directory.');
            throw new Error('Bot file not found');
        }
    }
}

/**
 * ================================
 * KEEP-ALIVE SERVICE
 * ================================
 */
class KeepAliveService {
    constructor(port) {
        this.port = port;
        this.isEnabled = true;
        this.cronJob = null;
        this.setupKeepAlive();
    }

    setupKeepAlive() {
        // Self-ping to prevent server shutdown
        const cronPattern = `*/${CONFIG.KEEP_ALIVE_INTERVAL} * * * *`;
        
        this.cronJob = cron.schedule(cronPattern, async () => {
            if (!this.isEnabled) return;
            
            try {
                const response = await axios.get(`http://localhost:${this.port}/health`, {
                    timeout: 5000,
                    headers: { 'User-Agent': 'KeepAlive-Bot/1.0' }
                });
                
                if (response.status === 200) {
                    Logger.debug(`Keep-alive ping successful - Server is healthy`);
                } else {
                    Logger.warning(`Keep-alive ping returned status: ${response.status}`);
                }
            } catch (error) {
                Logger.warning(`Keep-alive ping failed: ${error.message}`);
            }
        }, {
            scheduled: false,
            timezone: "UTC"
        });
        
        Logger.success(`Keep-alive service configured (every ${CONFIG.KEEP_ALIVE_INTERVAL} minutes)`);
    }

    start() {
        if (this.cronJob) {
            this.cronJob.start();
            this.isEnabled = true;
            Logger.info('Keep-alive service started');
        }
    }

    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            this.isEnabled = false;
            Logger.info('Keep-alive service stopped');
        }
    }

    destroy() {
        this.stop();
        if (this.cronJob) {
            this.cronJob.destroy();
            Logger.info('Keep-alive service destroyed');
        }
    }
}

/**
 * ================================
 * WEB SERVER MANAGER
 * ================================
 */
class WebServerManager {
    constructor(port, appName, startMethod) {
        this.port = port;
        this.appName = appName;
        this.startMethod = startMethod;
        this.server = null;
        this.isStarted = false;
        this.keepAliveService = new KeepAliveService(port);
    }

    async setup() {
        if (this.isStarted) {
            Logger.warning('Web server is already running');
            return;
        }

        Logger.info(`Setting up web server on port ${this.port}...`);

        const app = express();
        
        // Configure keep-alive settings
        app.use((req, res, next) => {
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Keep-Alive', 'timeout=120, max=1000');
            next();
        });

        // Middleware
        app.use(express.json({ limit: '10mb' }));
        app.use(express.urlencoded({ extended: true, limit: '10mb' }));

        // Routes
        this.setupRoutes(app);

        // Error handling
        this.setupErrorHandling(app);

        return this.startServer(app);
    }

    setupRoutes(app) {
        // Main route
        app.get('/', (req, res) => {
            const uptime = process.uptime();
            const uptimeFormatted = this.formatUptime(uptime);
            
            res.send(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>${this.appName} - Bot Dashboard</title>
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        body { 
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            min-height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }
                        .container { 
                            background: rgba(255, 255, 255, 0.95);
                            padding: 40px;
                            border-radius: 20px;
                            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
                            text-align: center;
                            max-width: 500px;
                            width: 90%;
                        }
                        .logo { 
                            font-size: 3em; 
                            margin-bottom: 20px;
                            color: #4CAF50;
                        }
                        h1 { 
                            color: #333; 
                            margin-bottom: 10px;
                            font-weight: 300;
                        }
                        .status { 
                            color: #4CAF50; 
                            font-size: 1.2em;
                            margin: 20px 0;
                            font-weight: 500;
                        }
                        .info { 
                            color: #666; 
                            margin: 10px 0;
                            padding: 10px;
                            background: #f8f9fa;
                            border-radius: 8px;
                        }
                        .badge {
                            display: inline-block;
                            padding: 5px 12px;
                            background: #007bff;
                            color: white;
                            border-radius: 15px;
                            font-size: 0.8em;
                            margin: 5px;
                        }
                        .pulse {
                            animation: pulse 2s infinite;
                        }
                        @keyframes pulse {
                            0% { transform: scale(1); }
                            50% { transform: scale(1.05); }
                            100% { transform: scale(1); }
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="logo pulse">🤖</div>
                        <h1>${this.appName}</h1>
                        <div class="status">✅ ONLINE & ACTIVE</div>
                        <div class="info">
                            <strong>Uptime:</strong> ${uptimeFormatted}
                        </div>
                        <div class="info">
                            <strong>Mode:</strong> 
                            <span class="badge">${this.startMethod.toUpperCase()}</span>
                        </div>
                        <div class="info">
                            <strong>Environment:</strong> 
                            <span class="badge">${CONFIG.NODE_ENV.toUpperCase()}</span>
                        </div>
                        <div class="info">
                            <strong>Keep-Alive:</strong> 
                            <span class="badge">ENABLED</span>
                        </div>
                    </div>
                </body>
                </html>
            `);
        });

        // Health check endpoint
        app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                version: process.version,
                app: this.appName,
                mode: this.startMethod
            });
        });

        // Status endpoint
        app.get('/status', (req, res) => {
            res.json({
                app: this.appName,
                status: 'running',
                mode: this.startMethod,
                uptime: this.formatUptime(process.uptime()),
                port: this.port,
                keepAlive: this.keepAliveService.isEnabled,
                timestamp: new Date().toISOString()
            });
        });

        // 404 handler
        app.use((req, res) => {
            res.status(404).json({
                error: 'Not Found',
                message: 'The requested resource was not found',
                path: req.path
            });
        });
    }

    setupErrorHandling(app) {
        // Global error handler
        app.use((err, req, res, next) => {
            Logger.error(`Server error: ${err.message}`);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Something went wrong on our end'
            });
        });
    }

    startServer(app) {
        return new Promise((resolve, reject) => {
            this.server = app.listen(this.port, () => {
                this.isStarted = true;
                Logger.success(`🌐 Web server running at http://localhost:${this.port}`);
                
                // Configure server timeouts for keep-alive
                this.server.keepAliveTimeout = CONFIG.SERVER_TIMEOUT;
                this.server.headersTimeout = CONFIG.SERVER_TIMEOUT + 1000;
                
                // Start keep-alive service
                this.keepAliveService.start();
                
                resolve();
            });

            this.server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    Logger.warning(`Port ${this.port} is already in use, assuming server is running`);
                    this.isStarted = true;
                    resolve();
                } else {
                    Logger.error(`Failed to start web server: ${err.message}`);
                    reject(err);
                }
            });
        });
    }

    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (days > 0) return `${days}d ${hours}h ${minutes}m ${secs}s`;
        if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
        if (minutes > 0) return `${minutes}m ${secs}s`;
        return `${secs}s`;
    }

    async shutdown() {
        Logger.info('Shutting down web server...');
        
        this.keepAliveService.destroy();
        
        if (this.server) {
            return new Promise((resolve) => {
                this.server.close(() => {
                    Logger.success('Web server shutdown complete');
                    resolve();
                });
            });
        }
    }
}

/**
 * ================================
 * BOT PROCESS MANAGER
 * ================================
 */
class BotProcessManager {
    constructor(startMethod) {
        this.startMethod = startMethod;
        this.botProcess = null;
        this.restartCount = 0;
        this.restartTimeout = null;
        this.isShuttingDown = false;
    }

    async start() {
        const mainFile = await FileManager.validateBotFile();
        
        if (this.startMethod === 'pm2') {
            return this.startWithPM2(mainFile);
        } else {
            return this.startDirectly(mainFile);
        }
    }

    async startWithPM2(mainFile) {
        Logger.info('🚀 Starting bot with PM2...');

        // Clean up any existing PM2 process
        await this.cleanupPM2();

        const pm2Config = this.getPM2Config();
        const npmCommand = await this.detectPackageManager();

        const pm2Process = spawn(npmCommand.command, [
            ...npmCommand.pm2Args,
            'start',
            'ecosystem.config.js',
            '--name', CONFIG.APP_NAME,
            '--node-args="--max-old-space-size=2048"',
            '--instances', 'max',
            '--attach'
        ], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, ...pm2Config.env }
        });

        return this.handlePM2Process(pm2Process);
    }

    async startDirectly(mainFile) {
        Logger.info('🚀 Starting bot directly with Node.js...');

        const args = [
            '--max-old-space-size=2048',
            mainFile,
            ...process.argv.slice(2)
        ];

        this.botProcess = spawn(process.execPath, args, {
            stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
            env: {
                ...process.env,
                NODE_ENV: CONFIG.NODE_ENV,
                PM2_USAGE: 'false',
                FORCE_COLOR: 'true'
            }
        });

        this.setupProcessHandlers();
        
        return new Promise((resolve) => {
            this.botProcess.on('spawn', () => {
                Logger.success('✅ Bot process spawned successfully');
                resolve();
            });

            setTimeout(() => {
                if (this.botProcess) resolve();
            }, 5000);
        });
    }

    setupProcessHandlers() {
        if (!this.botProcess) return;

        // Handle stdout and stderr
        this.botProcess.stdout.on('data', (data) => {
            process.stdout.write(data.toString());
        });

        this.botProcess.stderr.on('data', (data) => {
            process.stderr.write(data.toString());
        });

        // Handle process events
        this.botProcess.on('message', (data) => {
            if (data === 'reset' && !this.isShuttingDown) {
                Logger.info('Received reset message from bot');
                this.scheduleRestart();
            }
        });

        this.botProcess.on('exit', (code, signal) => {
            Logger.warning(`Bot process exited with code ${code} and signal ${signal}`);
            if (code !== 0 && !this.isShuttingDown) {
                this.scheduleRestart();
            }
        });

        this.botProcess.on('error', (err) => {
            Logger.error(`Bot process error: ${err.message}`);
            if (!this.isShuttingDown) {
                this.scheduleRestart();
            }
        });
    }

    scheduleRestart() {
        if (this.restartTimeout) {
            clearTimeout(this.restartTimeout);
        }

        this.restartCount++;
        
        if (this.restartCount > CONFIG.MAX_RESTARTS) {
            Logger.error(`Too many restarts (${this.restartCount}). Waiting before trying again...`);
            this.restartTimeout = setTimeout(() => {
                this.restartCount = 0;
                this.restart();
            }, 60000); // Wait 1 minute
            return;
        }

        this.restartTimeout = setTimeout(() => {
            this.restart();
        }, CONFIG.RESTART_DELAY);
    }

    async restart() {
        if (this.isShuttingDown) return;
        
        Logger.info('🔄 Restarting bot...');
        await this.kill();
        
        setTimeout(async () => {
            try {
                await this.start();
                Logger.success('✅ Bot restarted successfully');
            } catch (error) {
                Logger.error(`Failed to restart bot: ${error.message}`);
            }
        }, 1000);
    }

    async kill() {
        this.isShuttingDown = true;
        
        // Clear restart timeout
        if (this.restartTimeout) {
            clearTimeout(this.restartTimeout);
            this.restartTimeout = null;
        }

        // Kill PM2 process
        await this.cleanupPM2();

        // Kill direct Node process
        if (this.botProcess) {
            try {
                this.botProcess.removeAllListeners();
                this.botProcess.kill('SIGTERM');

                // Force kill after timeout
                setTimeout(() => {
                    if (this.botProcess) {
                        this.botProcess.kill('SIGKILL');
                        this.botProcess = null;
                    }
                }, 5000);

                Logger.success('Bot process terminated');
            } catch (err) {
                Logger.error(`Error killing bot process: ${err.message}`);
            }
            this.botProcess = null;
        }
    }

    async cleanupPM2() {
        try {
            const npmCommand = await this.detectPackageManager();
            spawnSync(npmCommand.command, [...npmCommand.pm2Args, 'delete', CONFIG.APP_NAME], {
                stdio: 'ignore'
            });
        } catch (err) {
            // Ignore cleanup errors
        }
    }

    async detectPackageManager() {
        try {
            spawnSync('yarn', ['--version'], { stdio: 'ignore' });
            Logger.debug('Using yarn for package management');
            return { command: 'yarn', pm2Args: ['pm2'] };
        } catch (err) {
            Logger.debug('Using npx for package management');
            return { command: 'npx', pm2Args: ['pm2'] };
        }
    }

    getPM2Config() {
        return {
            env: {
                ...process.env,
                FORCE_COLOR: 'true',
                PM2_USAGE: 'true',
                NODE_ENV: CONFIG.NODE_ENV
            }
        };
    }

    async handlePM2Process(pm2Process) {
        return new Promise((resolve, reject) => {
            let restartCount = 0;

            pm2Process.stdout.on('data', (data) => {
                console.log(data.toString());
            });

            pm2Process.stderr.on('data', (data) => {
                const output = data.toString();
                console.error(output);

                if (output.includes('restart')) {
                    restartCount++;
                    if (restartCount > CONFIG.MAX_RESTARTS) {
                        Logger.warning('PM2 restarting too frequently, falling back to direct execution');
                        pm2Process.kill();
                        this.startMethod = 'direct';
                        this.startDirectly().then(resolve).catch(reject);
                        return;
                    }
                }
            });

            pm2Process.on('exit', (code) => {
                if (code !== 0) {
                    Logger.warning(`PM2 exited with code ${code}, falling back to direct execution`);
                    this.startMethod = 'direct';
                    this.startDirectly().then(resolve).catch(reject);
                } else {
                    resolve();
                }
            });

            pm2Process.on('error', (error) => {
                Logger.error(`PM2 error: ${error.message}`);
                this.startMethod = 'direct';
                this.startDirectly().then(resolve).catch(reject);
            });

            // Resolve after timeout
            setTimeout(resolve, 10000);
        });
    }
}

/**
 * ================================
 * MAIN BOT MANAGER CLASS
 * ================================
 */
class BotManager {
    constructor() {
        this.webServer = new WebServerManager(CONFIG.PORT, CONFIG.APP_NAME, CONFIG.START_METHOD);
        this.botProcess = new BotProcessManager(CONFIG.START_METHOD);
        this.isShuttingDown = false;
        
        this.setupShutdownHooks();
        this.displayWelcomeMessage();
        this.initialize();
    }

    displayWelcomeMessage() {
        console.clear();
        console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║    🤖 ${CONFIG.APP_NAME} - Enhanced Bot Manager                    ║
║                                                               ║
║    ✨ Features:                                               ║
║    • Keep-alive system (every ${CONFIG.KEEP_ALIVE_INTERVAL} minutes)                      ║
║    • Auto-restart on crashes                                 ║
║    • Health monitoring                                       ║
║    • Graceful shutdown                                       ║
║    • Web dashboard                                           ║
║                                                               ║
║    🚀 Starting in ${CONFIG.START_METHOD.toUpperCase()} mode...                             ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
        `);
    }

    setupShutdownHooks() {
        const signals = ['SIGINT', 'SIGTERM', 'SIGUSR2'];
        signals.forEach(signal => {
            process.on(signal, async () => {
                Logger.info(`Received ${signal}, initiating graceful shutdown...`);
                await this.shutdown();
                process.exit(0);
            });
        });

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            Logger.error(`Uncaught Exception: ${error.message}`);
            Logger.error(error.stack);
        });

        process.on('unhandledRejection', (reason, promise) => {
            Logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
        });
    }

    async initialize() {
        try {
            Logger.info('🔧 Initializing bot manager...');
            
            // Setup environment
            await FileManager.ensureDirectories();
            await FileManager.cleanupDirectories();
            
            // Start services
            await this.webServer.setup();
            await this.botProcess.start();
            
            Logger.success(`🎉 ${CONFIG.APP_NAME} startup complete!`);
            Logger.info(`📊 Dashboard: http://localhost:${CONFIG.PORT}`);
            Logger.info(`💓 Keep-alive: Active (${CONFIG.KEEP_ALIVE_INTERVAL}min intervals)`);
            
            // Send ready signal to PM2 if running under PM2
            if (process.send) {
                process.send('ready');
                Logger.debug('Sent ready signal to PM2');
            }
            
        } catch (error) {
            Logger.error(`❌ Startup failed: ${error.message}`);
            process.exit(1);
        }
    }

    async shutdown() {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;
        
        Logger.info('🔄 Shutting down bot manager...');
        
        try {
            await Promise.all([
                this.webServer.shutdown(),
                this.botProcess.kill()
            ]);
            
            Logger.success('✅ Shutdown complete');
        } catch (error) {
            Logger.error(`Shutdown error: ${error.message}`);
        }
    }
}

// Start the bot manager
new BotManager();

module.exports = BotManager;
