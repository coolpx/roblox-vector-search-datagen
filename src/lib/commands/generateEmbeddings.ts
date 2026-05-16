import fs from 'fs';
import path from 'path';
import 'dotenv/config';

export async function generateEmbeddings() {
    // load games
    const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
    if (!fs.existsSync(gamesPath)) {
        console.error('games.json not found. Run gatherGames first.');
        return;
    }
    const games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
    console.log(`Total games: ${games.length}`);

    // load existing embeddings
    const embeddingsPath = path.join(process.cwd(), 'data', 'games', 'embeddings.json');
    let existingEmbeddings: Record<number, number[]> = {};
    if (fs.existsSync(embeddingsPath)) {
        existingEmbeddings = JSON.parse(fs.readFileSync(embeddingsPath, 'utf-8'));
        console.log(`Loaded ${Object.keys(existingEmbeddings).length} existing embeddings`);
    }

    // filter games that need embeddings
    const gamesNeedingEmbeddings = games.filter(
        game =>
            !(game.universeId in existingEmbeddings) ||
            !existingEmbeddings[game.universeId] ||
            existingEmbeddings[game.universeId].length === 0
    );

    console.log(`Games needing embeddings: ${gamesNeedingEmbeddings.length}`);
    if (gamesNeedingEmbeddings.length === 0) {
        console.log('All games already have embeddings.');
        return;
    }

    // filter games without gameplay descriptions
    const gamesWithDescriptions = gamesNeedingEmbeddings.filter(
        game => game.gameplayDescription && game.gameplayDescription.trim() !== ''
    );

    console.log(
        `Games with valid gameplay descriptions for embeddings: ${gamesWithDescriptions.length}`
    );
    if (gamesWithDescriptions.length === 0) {
        console.log('No games have valid gameplay descriptions for embeddings.');
        return;
    }

    console.log(`Generating embeddings for ${gamesWithDescriptions.length} games...`);

    // generate embeddings in batches
    const batchSize = 10;
    for (let i = 0; i < gamesWithDescriptions.length; i += batchSize) {
        const batch = gamesWithDescriptions.slice(i, i + batchSize);
        console.log(
            `[${i + 1}-${Math.min(i + batchSize, gamesWithDescriptions.length)}/${gamesWithDescriptions.length}] Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(gamesWithDescriptions.length / batchSize)}`
        );
        try {
            const descriptions = batch.map(game => game.gameplayDescription!);
            const embeddingsResponse = await fetch(
                process.env.EMBEDDING_BASE_URL! + '/embeddings',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${process.env.EMBEDDING_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: process.env.EMBEDDING_MODEL,
                        input: descriptions
                    })
                }
            );
            const embeddingsData = await embeddingsResponse.json();
            const embeddings = embeddingsData.data;
            for (let j = 0; j < batch.length; j++) {
                const game = batch[j];
                const embedding = embeddings[j];
                if (embedding && embedding.embedding && embedding.embedding.length > 0) {
                    existingEmbeddings[game.universeId] = embedding.embedding;
                    console.log(
                        `[${i + j + 1}/${gamesWithDescriptions.length}] Generated embedding for game: ${game.name}`
                    );
                } else {
                    console.warn(
                        `[${i + j + 1}/${gamesWithDescriptions.length}] No valid embedding generated for game: ${game.name}`
                    );
                }
            }
        } catch (error) {
            console.error(
                `[${i + 1}-${Math.min(i + batchSize, gamesWithDescriptions.length)}/${gamesWithDescriptions.length}] Failed to generate embeddings for batch:`,
                error
            );
        }

        // Save progress every 10 batches (100 embeddings)
        if ((i / batchSize + 1) % 10 === 0 || i + batchSize >= gamesWithDescriptions.length) {
            fs.writeFileSync(embeddingsPath, JSON.stringify(existingEmbeddings, null));
            console.log(
                `Saved progress after ${Math.min(i + batchSize, gamesWithDescriptions.length)} embeddings to ${embeddingsPath}`
            );
        }
    }

    // Final save
    fs.writeFileSync(embeddingsPath, JSON.stringify(existingEmbeddings, null));
    console.log(
        `Generated embeddings for ${gamesWithDescriptions.length} games in ${embeddingsPath}`
    );
}
