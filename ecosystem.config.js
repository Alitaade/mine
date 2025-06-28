module.exports = {
    apps: [{
        name: 'PAUL-MD',                  // Name of the application
        script: 'telegram.js',            // Entry point of your application
        instances: 1,                     // Single instance is usually better for bots
        exec_mode: 'cluster',                // 'fork' is recommended for most Node.js apps
        watch: false,                      // Enable watch mode to auto-restart on file changes
        watch_delay: 3000,                // Delay between file change detection
        ignore_watch: [                   // Ignore these directories/files when watching
            'node_modules',
            'logs',
            '.git',
            'session',
            'tmp',
            '*.log'
        ],
        max_memory_restart: '2006G',         // More realistic memory limit (4GB)
        autorestart: true,                // Automatically restart the app if it crashes
        max_restarts: 10,                 // Maximum number of restarts in a short period
        restart_delay: 3000,              // Delay between restarts (3 seconds)
        wait_ready: true,                 // Wait for the "ready" signal from the app
        listen_timeout: 10000,            // Timeout for the app to start listening
        kill_timeout: 5000,               // Timeout for the app to shut down gracefully
        env: {
            NODE_ENV: 'production',       // Set environment to production
            PM2_USAGE: 'true',            // Indicate that PM2 is being used
            FORCE_COLOR: 'true'           // Force colored console output
        },
        node_args: '--max-old-space-size=900000', // Limit Node.js memory usage
        log_date_format: 'YYYY-MM-DD HH:mm:ss', // Format for log timestamps
        out_file: './logs/app.log',       // Save stdout to log file
        error_file: './logs/error.log',   // Save stderr to log file
        merge_logs: true,                 // Merge logs when running multiple instances
        log_type: 'json',                 // Better formatting for logs
        out_file: '/dev/null',            // Discard PM2's stdout
        error_file: '/dev/null',          // Discard PM2's stderr
        log_file: '/dev/null',            // Discard PM2's combined logs
        disable_logs: true,               // Disable PM2's own logs
        silent: true,                     // Run in silent mode
        instance_var: 'INSTANCE_ID',      // Environment variable for instance ID
        min_uptime: '30s',                // Minimum uptime before considering the app stable
        vizion: false,                    // Disable version control metadata (better performance)
        source_map_support: true,         // Source map support for better error reporting
        combine_logs: true,               // Combine logs from different instances
        trace: true                       // Enable stack trace collection
    }]
};