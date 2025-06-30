const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const APP_NAME = process.env.APP_NAME || 'PAUL-MD';
const PORT = process.env.PORT || 9699;
const REQUIRED_DIRS = ['tmp', 'XeonMedia', 'lib', 'src', 'session'];

class VercelBotServer {
    constructor() {
        this.app = express();
        this.botProcess = null;
        this.isReady = false;
        this.serverInstance = null;
        this.init();
    }

    async init() {
        try {
            console.log('Starting initialization...');
            await this.setupDirectories();
            this.setupRoutes();
            
            // Start bot after routes are set up
            await this.startBot();
            
            // Only start server if not in Vercel serverless environment
            if (!process.env.VERCEL) {
                this.startServer();
            }
        } catch (error) {
            console.error('Initialization failed:', error.message);
            console.error('Stack trace:', error.stack);
            // Don't exit in Vercel environment
            if (!process.env.VERCEL) {
                process.exit(1);
            }
        }
    }

    async setupDirectories() {
        console.log('Setting up directories...');
        try {
            await Promise.all(
                REQUIRED_DIRS.map(async (dir) => {
                    const fullPath = path.join(__dirname, dir);
                    try {
                        await fs.access(fullPath);
                        console.log(`Directory ${dir} exists`);
                    } catch {
                        await fs.mkdir(fullPath, { recursive: true });
                        console.log(`Created directory ${dir}`);
                    }
                })
            );
        } catch (error) {
            console.error('Error setting up directories:', error.message);
            throw error;
        }
    }

    async startBot() {
        const telegramFile = path.join(__dirname, 'telegram.js');
        
        try {
            await fs.access(telegramFile);
            console.log('telegram.js found, starting bot...');
        } catch {
            console.warn('telegram.js not found, running in server-only mode');
            this.isReady = true;
            return;
        }

        // Don't start bot process in Vercel serverless environment
        if (process.env.VERCEL) {
            console.log('Running in Vercel environment, skipping bot process');
            this.isReady = true;
            return;
        }

        try {
            this.botProcess = spawn('node', [
                '--max-old-space-size=512000',
                telegramFile
            ], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    NODE_ENV: 'production'
                },
                cwd: __dirname
            });

            this.botProcess.stdout.on('data', (data) => {
                const output = data.toString();
                console.log('Bot output:', output);
                if (output.includes('ready') || output.includes('connected') || output.includes('started')) {
                    this.isReady = true;
                }
            });

            this.botProcess.stderr.on('data', (data) => {
                const error = data.toString();
                console.error('Bot stderr:', error);
                if (!error.includes('warning') && !error.includes('deprecated')) {
                    console.error('Bot error:', error);
                }
            });

            this.botProcess.on('error', (error) => {
                console.error('Failed to start bot process:', error.message);
                this.isReady = false;
            });

            this.botProcess.on('exit', (code, signal) => {
                console.log(`Bot process exited with code ${code} and signal ${signal}`);
                if (code !== 0 && !signal) {
                    this.isReady = false;
                    console.log('Restarting bot in 5 seconds...');
                    setTimeout(() => this.startBot(), 5000);
                }
            });

            // Set ready state after timeout if no explicit ready signal
            setTimeout(() => {
                if (!this.isReady) {
                    console.log('Setting ready state after timeout');
                    this.isReady = true;
                }
            }, 15000);

        } catch (error) {
            console.error('Error starting bot:', error.message);
            this.isReady = true; // Set ready even if bot fails to start
        }
    }

    setupRoutes() {
        console.log('Setting up routes...');
        
        // Add middleware for parsing JSON and URL-encoded data
        this.app.use(express.json({ limit: '50mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({ 
                status: 'ok', 
                bot: this.isReady ? 'running' : 'starting',
                timestamp: new Date().toISOString(),
                environment: process.env.NODE_ENV || 'development',
                vercel: !!process.env.VERCEL
            });
        });

        // Main route
        this.app.get('/', (req, res) => {
            const status = this.isReady ? 'LIVE' : 'STARTING';
            const color = this.isReady ? '#4CAF50' : '#FF9800';
            
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>${APP_NAME} - Bot ${status}</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        body { 
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            min-height: 100vh; display: flex; align-items: center; justify-content: center;
                            padding: 20px;
                        }
                        .container { 
                            background: white; padding: 2rem; border-radius: 16px;
                            box-shadow: 0 20px 40px rgba(0,0,0,0.1); text-align: center; max-width: 400px;
                            width: 100%;
                        }
                        h1 { color: ${color}; margin-bottom: 1rem; font-size: 2rem; }
                        .status { 
                            display: inline-block; padding: 0.5rem 1rem; border-radius: 20px;
                            background: ${color}; color: white; font-weight: bold; margin: 1rem 0;
                        }
                        .info { color: #666; margin-top: 1rem; }
                        .pulse { animation: pulse 2s infinite; }
                        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>${APP_NAME}</h1>
                        <div class="status ${!this.isReady ? 'pulse' : ''}">${status}</div>
                        <div class="info">
                            ${this.isReady ? 'Bot is ready and operational' : 'Bot is initializing...'}
                        </div>
                        <div class="info" style="margin-top: 2rem; font-size: 0.9em;">
                            ${process.env.VERCEL ? 'Deployed on Vercel' : 'Running locally'}
                        </div>
                    </div>
                    ${!this.isReady ? '<script>setTimeout(() => location.reload(), 5000);</script>' : ''}
                </body>
                </html>
            `);
        });

        // API endpoint for bot status
        this.app.get('/api/status', (req, res) => {
            res.json({
                app: APP_NAME,
                status: this.isReady ? 'ready' : 'starting',
                bot: this.botProcess ? 'running' : 'not_started',
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                env: process.env.NODE_ENV || 'development',
                vercel: !!process.env.VERCEL,
                timestamp: new Date().toISOString()
            });
        });

        // Webhook endpoint (common for Telegram bots)
        this.app.post('/webhook', (req, res) => {
            console.log('Webhook received:', req.body);
            res.status(200).json({ status: 'ok' });
        });

        // Catch all other routes
        this.app.use('*', (req, res) => {
            res.status(404).json({ 
                error: 'Route not found',
                path: req.originalUrl,
                method: req.method
            });
        });

        // Error handling middleware
        this.app.use((err, req, res, next) => {
            console.error('Express error:', err.message);
            console.error('Stack:', err.stack);
            res.status(500).json({ 
                error: 'Internal server error',
                message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
            });
        });
    }

    startServer() {
        if (this.serverInstance) {
            console.log('Server already running');
            return;
        }

        this.serverInstance = this.app.listen(PORT, () => {
            console.log(`✅ Server running on port ${PORT}`);
            console.log(`🔗 Health check: http://localhost:${PORT}/health`);
            
            // Signal to process manager that app is ready
            if (process.send) {
                process.send('ready');
            }
        });

        this.serverInstance.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`Port ${PORT} in use, trying next available port`);
                const newServer = this.app.listen(0, () => {
                    console.log(`✅ Server running on port ${newServer.address().port}`);
                });
                this.serverInstance = newServer;
            } else {
                console.error('Server error:', err.message);
            }
        });

        // Graceful shutdown
        const shutdown = (signal) => {
            console.log(`Received ${signal}, shutting down gracefully...`);
            this.serverInstance.close(() => {
                console.log('Server closed');
                if (this.botProcess) {
                    this.botProcess.kill('SIGTERM');
                    setTimeout(() => {
                        if (this.botProcess && !this.botProcess.killed) {
                            this.botProcess.kill('SIGKILL');
                        }
                    }, 5000);
                }
                process.exit(0);
            });
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
    }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Start the application
const server = new VercelBotServer();

// Export for Vercel serverless functions
module.exports = server.app;

// Also export the handler function for Vercel
module.exports.handler = (req, res) => {
    return server.app(req, res);
};
