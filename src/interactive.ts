// modules
import { commands } from './lib/commands';

// main function
async function main() {
    const [, , cmd] = process.argv;
    if (!cmd || !(cmd in commands)) {
        console.log('Available commands:');
        for (const name of Object.keys(commands)) {
            console.log('  -', name);
        }
        process.exit(1);
    }
    await commands[cmd]();
}

main();
