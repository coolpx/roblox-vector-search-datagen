import fs from 'fs';
import path from 'path';
import { cosineSimilarity } from '../tools';

export async function findSimilarGames() {
    // find game from argument
    const game = process.argv[3];
    if (!game) {
        console.error('Please provide a game universeId to find similar games.');
        return;
    }

    // load embeddings
    const embeddingsPath = path.join(process.cwd(), 'data', 'games', 'embeddings.json');
    if (!fs.existsSync(embeddingsPath)) {
        console.error('embeddings.json not found. Run generateEmbeddings first.');
        return;
    }
    const embeddings: Record<number, number[]> = JSON.parse(
        fs.readFileSync(embeddingsPath, 'utf-8')
    );

    // get embeddings for the specified game
    const universeId = parseInt(game);
    if (!(universeId in embeddings)) {
        console.error(`No embeddings found for game with universeId ${universeId}.`);
        return;
    }
    const targetEmbedding = embeddings[universeId];

    // run cosine similarity search
    const similarGames: { universeId: number; similarity: number }[] = [];
    for (const [id, embedding] of Object.entries(embeddings)) {
        if (parseInt(id) === universeId) continue; // skip the target game itself
        const similarity = cosineSimilarity(targetEmbedding, embedding);
        similarGames.push({ universeId: parseInt(id), similarity });
    }

    // sort by similarity
    similarGames.sort((a, b) => b.similarity - a.similarity);

    // load games
    const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
    if (!fs.existsSync(gamesPath)) {
        console.error('games.json not found. Run gatherGames first.');
        return;
    }

    const games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));

    // output top 10 similar games as a table
    const targetGame = games.find(game => game.universeId === universeId);
    console.log(`\nTop 10 similar games to ${targetGame?.name}:\n`);

    // Table header
    console.log(
        'Rank | Game Name                                      | Universe ID | Similarity | Link'
    );
    console.log(
        '-----|------------------------------------------------|-------------|------------|-----------------------------------------------------'
    );

    for (let i = 0; i < Math.min(10, similarGames.length); i++) {
        const gameId = similarGames[i].universeId;
        const similarity = similarGames[i].similarity.toFixed(4);
        const game = games.find(g => g.universeId === gameId);
        const gameName = game?.name || 'Unknown Game';
        const placeId = game?.rootPlaceId || 'N/A';
        const link = placeId !== 'N/A' ? `https://roblox.com/games/${placeId}` : 'N/A';

        // Format row with proper alignment
        const rank = `${i + 1}`.padEnd(4);
        const nameFormatted =
            gameName.length > 46 ? gameName.substring(0, 43) + '...' : gameName.padEnd(46);
        const idFormatted = gameId.toString().padEnd(11);
        const simFormatted = similarity.padEnd(10);

        console.log(`${rank} | ${nameFormatted} | ${idFormatted} | ${simFormatted} | ${link}`);
    }
}
