import fs from 'fs';
import path from 'path';
import { cosineSimilarity } from '../tools';
import 'dotenv/config';

export async function search() {
    const args = process.argv.slice(3);
    let limit = 10;
    const queryParts: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--limit' || arg === '-n') {
            const parsed = parseInt(args[i + 1] || '', 10);
            if (!isNaN(parsed) && parsed > 0) {
                limit = Math.min(parsed, 100);
            }
            i++;
            continue;
        }

        const limitMatch = arg.match(/^--limit=(\d+)$/);
        if (limitMatch) {
            limit = Math.min(parseInt(limitMatch[1], 10), 100);
            continue;
        }

        queryParts.push(arg);
    }

    const query = queryParts.join(' ').trim();

    if (!query) {
        console.error(
            'Please provide search text. Example: npm run interactive -- search "obby with pets" --limit 10'
        );
        return;
    }

    const embeddingsPath = path.join(process.cwd(), 'data', 'games', 'embeddings.json');
    if (!fs.existsSync(embeddingsPath)) {
        console.error('embeddings.json not found. Run generateEmbeddings first.');
        return;
    }

    const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
    if (!fs.existsSync(gamesPath)) {
        console.error('games.json not found. Run gatherGames first.');
        return;
    }

    const embeddings: Record<number, number[]> = JSON.parse(
        fs.readFileSync(embeddingsPath, 'utf-8')
    );
    const games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
    const gameMap = new Map(games.map(game => [game.universeId, game]));

    const queryEmbeddingResponse = await fetch(process.env.EMBEDDING_BASE_URL! + '/embeddings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.EMBEDDING_API_KEY}`
        },
        body: JSON.stringify({
            model: process.env.EMBEDDING_MODEL,
            input: query
        })
    });
    const queryEmbeddingData = await queryEmbeddingResponse.json();
    const queryEmbedding = queryEmbeddingData.data[0].embedding;

    const searchResults: { universeId: number; similarity: number }[] = [];
    for (const [id, embedding] of Object.entries(embeddings)) {
        if (!Array.isArray(embedding) || embedding.length !== queryEmbedding.length) {
            continue;
        }

        searchResults.push({
            universeId: parseInt(id, 10),
            similarity: cosineSimilarity(queryEmbedding, embedding)
        });
    }

    searchResults.sort((a, b) => b.similarity - a.similarity);

    console.log(`\nTop ${Math.min(limit, searchResults.length)} games for "${query}":\n`);
    console.log(
        'Rank | Game Name                                      | Universe ID | Similarity | Link'
    );
    console.log(
        '-----|------------------------------------------------|-------------|------------|-----------------------------------------------------'
    );

    for (let i = 0; i < Math.min(limit, searchResults.length); i++) {
        const gameId = searchResults[i].universeId;
        const similarity = searchResults[i].similarity.toFixed(4);
        const game = gameMap.get(gameId);
        const gameName = game?.name || 'Unknown Game';
        const placeId = game?.rootPlaceId || 'N/A';
        const link = placeId !== 'N/A' ? `https://roblox.com/games/${placeId}` : 'N/A';

        const rank = `${i + 1}`.padEnd(4);
        const nameFormatted =
            gameName.length > 46 ? gameName.substring(0, 43) + '...' : gameName.padEnd(46);
        const idFormatted = gameId.toString().padEnd(11);
        const simFormatted = similarity.padEnd(10);

        console.log(`${rank} | ${nameFormatted} | ${idFormatted} | ${simFormatted} | ${link}`);
    }
}
