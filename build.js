const esbuild = require('esbuild');
const license = require('esbuild-plugin-license').default;

esbuild.build({
    entryPoints: ['index.js'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    outfile: 'dist/index.js',
    sourcemap: true,
    plugins: [license({
        thirdParty: {
            output: 'dist/licenses.txt',
        },
    })],
}).catch((err) => {
    console.error(err);
    process.exit(1);
});
