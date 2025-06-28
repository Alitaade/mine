module.exports = {
    appId: 'com.paul-md.bot',
    directories: {
        output: 'dist'
    },
    files: [
        '**/*',
        '!node_modules/**',
        '!*.test.js'
    ],
    extraMetadata: {
        main: 'index.js'
    },
    win: {
        target: ['portable']
    },
    mac: {
        target: ['default'],
        category: 'public.app-category.utilities'
    },
    linux: {
        target: ['AppImage']
    }
};