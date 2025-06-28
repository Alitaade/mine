const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const express = require('express');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

// Configurable constants
const APP_NAME = process.env.APP_NAME || 'PAUL-MD';
const SESSION_PATH = process.env.SESSION_PATH || './session/creds.json';
const DIRECTORIES = ['tmp', 'XeonMedia', 'lib', 'src', 'session'];
const PORT = process.env.PORT || 9699;
const START_METHOD = process.env.START_METHOD || 'direct'; // Default to direct if not specified

class BotManager {
    constructor() {
        this.botProcess = null;
        this.serverStarted = false;
        this.startMethod = START_METHOD.toLowerCase();
        this.setupShutdownHooks();
        this.startEverything();
    }

    // Setup hooks for graceful shutdown
    setupShutdownHooks() {
        const signals = ['SIGINT', 'SIGTERM', 'SIGUSR2']; // Handle various termination signals
        signals.forEach(signal => {
            process.on(signal, () => {
                console.log(`Received ${signal}, shutting down gracefully...`);
                this.shutdown().then(() => process.exit(0));
            });
        });
    }

    // Ensure directories exist and have correct permissions
    async ensurePermissions() {
        console.log('Setting up required directories...');
        await Promise.all(
            DIRECTORIES.map(async (dir) => {
                const fullPath = path.join(__dirname, dir);
                try {
                    await fs.access(fullPath);
                    console.log(`Directory ${dir} exists`);
                } catch {
                    await fs.mkdir(fullPath, { recursive: true });
                    console.log(`Created directory ${dir}`);
                }
                await fs.chmod(fullPath, 0o755);
            })
        );
    }

    // Delete cache and npm directories
    async deleteCacheAndNpm() {
        console.log('Cleaning cache directories...');
        const dirsToDelete = ['.cache', '.npm', 'logs'];
        await Promise.all(
            dirsToDelete.map(async (dir) => {
                const fullPath = path.join(__dirname, dir);
                try {
                    await fs.rm(fullPath, { recursive: true, force: true });
                    console.log(`Deleted ${dir}`);
                } catch (err) {
                    if (err.code !== 'ENOENT') { // Only log if error is not "directory doesn't exist"
                        console.error(`Error deleting ${dir}:`, err.message);
                    }
                }
            })
        );
    }

    // Start Express server
    async setupServer() {
        if (this.serverStarted) return;
        console.log(`Setting up web server on port ${PORT}...`);

        const app = express();

        app.get('/', (req, res) => {
            res.send(`
                <html>
                    <head>
                        <title>${APP_NAME} - Bot Live</title>
                        <style>
                            body { font-family: Arial, sans-serif; text-align: center; margin: 0; padding: 0; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f4f4f4; }
                            .container { background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); }
                            h1 { color: #4CAF50; }
                            p { color: #555; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <h1>${APP_NAME} is LIVE</h1>
                            <p>Your bot is running and ready!</p>
                            <p>Running in ${this.startMethod} mode</p>
                        </div>
                    </body>
                </html>
            `);
        });

        // Catch-all route for invalid paths
        app.use((req, res) => {
            res.status(404).send('Not Found');
        });

        // Error handling middleware
        app.use((err, req, res, next) => {
            console.error('Server error:', err.message);
            res.status(500).send('Internal Server Error');
        });

        return new Promise((resolve, reject) => {
            const server = app.listen(PORT, () => {
                this.serverStarted = true;
                console.log(`Web server running at http://localhost:${PORT}`);
                resolve();
            });
            
            server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    console.log(`Port ${PORT} is already in use, assuming server is already running`);
                    this.serverStarted = true;
                    resolve();
                } else {
                    console.error('Failed to start web server:', err.message);
                    reject(err);
                }
            });
        });
    }

    // Start bot with PM2
    async startBotWithPm2() {
        console.log('\x1b[36m%s\x1b[0m', 'Starting Telegram bot with PM2...');
        const mainFile = path.join(__dirname, 'telegram.js');
        
        // Check if telegram.js exists
        try {
            await fs.access(mainFile);
        } catch (err) {
            console.error('\x1b[31m%s\x1b[0m', 'Error: telegram.js not found! Please make sure it exists in the root directory.');
            process.exit(1);
        }

        // Try to delete any existing PM2 process with the same name
        try {
            spawnSync('npx', ['pm2', 'delete', APP_NAME], { 
                stdio: 'ignore' 
            });
        } catch (err) {
            // Ignore errors if the process doesn't exist
        }

        // Determine if we should use yarn or npx
        let npmCommand = 'npx';
        let pm2Command = ['pm2'];
        
        // Check if yarn is available
        try {
            spawnSync('yarn', ['--version'], { stdio: 'ignore' });
            npmCommand = 'yarn';
            pm2Command = ['pm2'];
            console.log('\x1b[32m%s\x1b[0m', 'Using yarn for package management');
        } catch (err) {
            // If yarn check fails, stick with npx
            console.log('\x1b[33m%s\x1b[0m', 'Yarn not found, using npx instead');
        }

        // Enable color in PM2 logs by setting env variables
        const env = {
            ...process.env,
            FORCE_COLOR: 'true',
            PM2_USAGE: 'true',
            NODE_ENV: 'production'
        };

        const pm2Process = spawn(npmCommand, [
            ...pm2Command,
            'start',
            'ecosystem.config.js',
            '--name', APP_NAME,
            '--node-args="--max-old-space-size=10000000"', // Correct usage of max-old-space-size
            '--instances', 'max', // Use all available CPU cores
            '--attach', // Keep attached to terminal to see logs
        ], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: env
        });

        let restartCount = 0;
        const maxRestarts = 5;

        // Set up event handlers for PM2
        pm2Process.stdout.on('data', (data) => {
            console.log(data.toString()); // Directly log the output
        });

        pm2Process.stderr.on('data', (data) => {
            const output = data.toString();
            console.error(data.toString()); // Directly log the error output
            
            // Check if output suggests PM2 is restarting repeatedly
            if (output.includes('restart')) {
                restartCount++;
                if (restartCount > maxRestarts) {
                    console.log('\x1b[31m%s\x1b[0m', 'PM2 is restarting indefinitely, falling back to direct Node execution...');
                    pm2Process.kill();
                    this.startMethod = 'direct'; // Update start method
                    this.startBotDirectly();
                    return;
                }
            }
        });

        return new Promise((resolve, reject) => {
            pm2Process.on('exit', (code) => {
                if (code !== 0) {
                    console.log('\x1b[31m%s\x1b[0m', `PM2 exited with code ${code}, falling back to direct Node execution...`);
                    this.startMethod = 'direct'; // Update start method
                    this.startBotDirectly().then(resolve).catch(reject);
                } else {
                    resolve();
                }
            });

            pm2Process.on('error', (error) => {
                console.error('\x1b[31m%s\x1b[0m', `PM2 error: ${error.message}`);
                this.startMethod = 'direct'; // Update start method
                this.startBotDirectly().then(resolve).catch(reject);
            });

            // Resolve after a timeout even if we don't get confirmation
            setTimeout(() => {
                resolve();
            }, 10000);
        });
    }

    // Start bot directly with Node.js
    async startBotDirectly() {
        console.log('\x1b[36m%s\x1b[0m', 'Starting Telegram bot directly with Node...');
        const mainFile = path.join(__dirname, 'telegram.js');
        
        const args = [
            '--max-old-space-size=10000000', // Correct usage of max-old-space-size
            // Removed the invalid --color flag
            mainFile,
            ...process.argv.slice(2)
        ];

        this.botProcess = spawn(process.execPath, args, {
            stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
            env: {
                ...process.env,
                NODE_ENV: 'production',
                PM2_USAGE: 'false',
                FORCE_COLOR: 'true'      // Force color in the environment instead of command line
            }
        });

        // Handle stdout and stderr directly
        this.botProcess.stdout.on('data', (data) => {
            process.stdout.write(data.toString());
        });
        
        this.botProcess.stderr.on('data', (data) => {
            process.stderr.write(data.toString());
        });

        this.setupProcessHandlers();

        return new Promise((resolve) => {
            this.botProcess.on('spawn', () => {
                console.log('\x1b[32m%s\x1b[0m', 'Bot process spawned successfully');
                resolve();
            });
            
            // Add timeout in case spawn event doesn't fire
            setTimeout(() => {
                if (this.botProcess) resolve();
            }, 5000);
        });
    }

    // Setup handlers for bot process events
    setupProcessHandlers() {
        if (!this.botProcess) return;

        // Debounce restarts to avoid rapid consecutive restarts
        let restartTimeout;
        let restartCount = 0;
        const MAX_RESTARTS = 5;
        const RESTART_RESET_TIME = 60000; // 1 minute
        
        const restartDebounce = () => {
            if (restartTimeout) clearTimeout(restartTimeout);
            
            // Check for too many restarts
            restartCount++;
            if (restartCount > MAX_RESTARTS) {
                console.error(`Too many restarts (${restartCount}) in a short period. Waiting before trying again.`);
                setTimeout(() => {
                    restartCount = 0;
                    this.restartBot();
                }, RESTART_RESET_TIME);
                return;
            }
            
            restartTimeout = setTimeout(() => {
                this.restartBot();
                
                // Reset restart count after some time to avoid counting old restarts
                setTimeout(() => {
                    restartCount = Math.max(0, restartCount - 1);
                }, RESTART_RESET_TIME);
            }, 2000); // 2-second debounce
        };

        // Handle messages from the bot process
        this.botProcess.on('message', (data) => {
            if (data === 'reset') {
                console.log('Received reset message from bot');
                restartDebounce();
            }
        });

        // Handle bot process exit
        this.botProcess.on('exit', (code, signal) => {
            console.log(`Bot process exited with code ${code} and signal ${signal}`);
            if (code !== 0) {
                restartDebounce();
            }
        });
        
        // Handle bot process error
        this.botProcess.on('error', (err) => {
            console.error('Bot process error:', err.message);
            restartDebounce();
        });
    }

    // Kill the bot process
    killBotProcess() {
        // First try to delete PM2 process
        try {
            // Check if yarn is available
            let npmCommand = 'npx';
            let pm2Command = ['pm2'];
            
            try {
                spawnSync('yarn', ['--version'], { stdio: 'ignore' });
                npmCommand = 'yarn';
                pm2Command = ['pm2'];
            } catch (err) {
                // If yarn check fails, stick with npx
            }
            
            spawnSync(npmCommand, [...pm2Command, 'delete', APP_NAME], { 
                stdio: 'ignore' 
            });
            console.log('PM2 process terminated');
        } catch (err) {
            // Ignore errors
        }

        // Then handle direct Node process if it exists
        if (this.botProcess) {
            try {
                this.botProcess.removeAllListeners();
                this.botProcess.kill('SIGTERM');
                
                // Force kill after a timeout if process doesn't exit
                setTimeout(() => {
                    if (this.botProcess) {
                        this.botProcess.kill('SIGKILL');
                        this.botProcess = null;
                    }
                }, 5000);
                
                console.log('Direct bot process terminated');
            } catch (err) {
                console.error('Error killing bot process:', err.message);
            }
            this.botProcess = null;
        }
    }

    // Restart the bot
    restartBot() {
        console.log('Restarting bot...');
        this.killBotProcess();
        setTimeout(() => {
            if (this.startMethod === 'pm2') {
                this.startBotWithPm2().catch(err => {
                    console.error('Failed to restart bot with PM2:', err.message);
                    this.startMethod = 'direct'; // Fallback to direct
                    this.startBotDirectly().catch(err => {
                        console.error('Failed to restart bot directly:', err.message);
                    });
                });
            } else {
                this.startBotDirectly().catch(err => {
                    console.error('Failed to restart bot directly:', err.message);
                    // Try PM2 as a last resort
                    this.startMethod = 'pm2';
                    this.startBotWithPm2().catch(err => {
                        console.error('Failed to restart bot with PM2 fallback:', err.message);
                        this.startMethod = 'direct'; // Reset back to direct
                    });
                });
            }
        }, 1000);
    }

    // Shutdown the bot and clean up
    shutdown() {
        return new Promise((resolve) => {
            console.log('Shutting down bot manager...');
            this.killBotProcess();
            setTimeout(() => {
                console.log('Bot manager shutdown complete');
                resolve();
            }, 1000);
        });
    }

    // Start everything in sequence
    async startEverything() {
        try {
            await this.ensurePermissions();
            await this.deleteCacheAndNpm();
            
            // Start bot based on START_METHOD env variable
            console.log(`Starting bot using ${this.startMethod} method...`);
            if (this.startMethod === 'pm2') {
                try {
                    await this.startBotWithPm2();
                } catch (err) {
                    console.error('Failed to start with PM2, falling back to direct:', err.message);
                    this.startMethod = 'direct';
                    await this.startBotDirectly();
                }
            } else {
                await this.startBotDirectly();
            }
            
            await this.setupServer();
            console.log(`${APP_NAME} startup complete in ${this.startMethod} mode!`);
            
            // Send ready signal to PM2 if running under PM2
            if (process.send) {
                process.send('ready');
                console.log('Sent ready signal to PM2');
            }
        } catch (error) {
            console.error('Error during startup:', error.message);
            process.exit(1);
        }
    }
}

// Create and start the bot manager
new BotManager();