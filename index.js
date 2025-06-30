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
        this.init();
    }

    async init() {
        try {
            await this.setupDirectories();
            await this.startBot();
            this.setupRoutes();
            this.startServer();
        } catch (error) {
            console.error('Initialization failed:', error.message);
            process.exit(1);
        }
    }

    async setupDirectories() {
        await Promise.all(
            REQUIRED_DIRS.map(async (dir) => {
                const fullPath = path.join(__dirname, dir);
                try {
                    await fs.access(fullPath);
                } catch {
                    await fs.mkdir(fullPath, { recursive: true });
                }
            })
        );
    }

    async startBot() {
        const telegramFile = path.join(__dirname, 'telegram.js');
        
        try {
            await fs.access(telegramFile);
        } catch {
            console.warn('telegram.js not found, running in server-only mode');
            this.isReady = true;
            return;
        }

        this.botProcess = spawn('node', [
            '--max-old-space-size=512000',
            telegramFile
        ], {
            stdio: 'pipe',
            env: {
                ...process.env,
                NODE_ENV: 'production'
            }
        });

        this.botProcess.stdout.on('data', (data) => {
            const output = data.toString();
            if (output.includes('ready') || output.includes('connected') || output.includes('started')) {
                this.isReady = true;
            }
        });

        this.botProcess.stderr.on('data', (data) => {
            const error = data.toString();
            if (!error.includes('warning') && !error.includes('deprecated')) {
                console.error('Bot error:', error);
            }
        });

        this.botProcess.on('exit', (code) => {
            if (code !== 0) {
                this.isReady = false;
                setTimeout(() => this.startBot(), 5000);
            }
        });

        // Set ready state after timeout if no explicit ready signal
        setTimeout(() => {
            this.isReady = true;
        }, 10000);
    }

    setupRoutes() {
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({ 
                status: 'ok', 
                bot: this.isReady ? 'running' : 'starting',
                timestamp: new Date().toISOString()
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
                            height: 100vh; display: flex; align-items: center; justify-content: center;
                        }
                        .container { 
                            background: white; padding: 2rem; border-radius: 16px;
                            box-shadow: 0 20px 40px rgba(0,0,0,0.1); text-align: center; max-width: 400px;
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
                            Deployed on Vercel
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
                env: process.env.NODE_ENV || 'development'
            });
        });

        // Catch all other routes
        this.app.use('*', (req, res) => {
            res.status(404).json({ error: 'Route not found' });
        });

        // Error handling
        this.app.use((err, req, res, next) => {
            res.status(500).json({ error: 'Internal server error' });
        });
    }

    startServer() {
        const server = this.app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            
            // Signal to Vercel that app is ready
            if (process.send) {
                process.send('ready');
            }
        });

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`Port ${PORT} in use, trying next port`);
                this.app.listen(0);
            } else {
                console.error('Server error:', err.message);
            }
        });

        // Graceful shutdown
        const shutdown = () => {
            server.close(() => {
                if (this.botProcess) {
                    this.botProcess.kill('SIGTERM');
                }
                process.exit(0);
            });
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    }
}

// Start the application
new VercelBotServer();

// Export for Vercel serverless functions (if needed)
module.exports = (req, res) => {
    // This allows the app to work as both a server and serverless function
    if (!global.vercelApp) {
        global.vercelApp = new VercelBotServer().app;
    }
    return global.vercelApp(req, res);
};
