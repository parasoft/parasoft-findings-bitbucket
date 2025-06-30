export async function run(): Promise<void> {
    if (process.argv.includes('--version')) {
        console.log(require('./package.json').version);
        process.exit(0);
    }
}

run()