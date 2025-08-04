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
    if (!(cmd in commands)) {
        console.error(`Command "${cmd}" is not implemented.`);
        process.exit(1);
    }
    const command = cmd as keyof typeof commands;
    await commands[command]();
}

main();
