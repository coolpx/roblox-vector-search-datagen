import { commands } from '../commands';

const start = Date.now();
let lastTimestamp = start;

async function logCheckpoint(message: string) {
    const timestamp = Date.now();
    const elapsed = Math.round(timestamp - start)
        .toString()
        .padStart(5, ' ');
    const elapsedSinceLast = Math.round(timestamp - lastTimestamp)
        .toString()
        .padStart(5, ' ');
    console.log(`\x1b[34m[${elapsed}ms task/${elapsedSinceLast}ms total] ${message}\x1b[0m`);
    lastTimestamp = timestamp;
}

export async function processGamesFromSearch() {
    const query = process.argv.slice(3).join(' ').trim();
    if (query.length === 0) {
        throw new Error('Please provide a search query.');
    }
    await commands.gatherGamesFromSearch(query);
    logCheckpoint('Gathered games from search');
    await Promise.all([commands.downloadDescriptions(), commands.downloadImages()]);
    logCheckpoint('Downloaded descriptions and images');
    await commands.generateGameplayDescriptions();
    logCheckpoint('Generated gameplay descriptions');
    await commands.generateEmbeddings();
    logCheckpoint('Generated embeddings');
}
