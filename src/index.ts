// modules
import { LMStudioClient } from '@lmstudio/sdk';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// types
type FilterSort = {
    contentType: 'Filters';
};

type Game = {
    universeId: number;
    rootPlaceId: number;
    name: string;
    description?: string | null;
    gameplayDescription?: string | null;
};

type GameSort = {
    contentType: 'Games';
    games: Game[];
};

// constants
const descriptionModel = 'google/gemma-3-4b';
const embeddingModel = 'CompendiumLabs/bge-large-en-v1.5-gguf/bge-large-en-v1.5-q8_0.gguf';

const client = new LMStudioClient();

// functions
async function loadSystemPrompt(name: 'gameplayAnalysis') {
    return fs.readFileSync(`./prompts/${name}.txt`, 'utf-8');
}

// command registry
const commands: Record<string, () => Promise<void>> = {
    async gatherGames() {
        // get sorts
        console.log('Getting game sorts');

        const apiUrl = new URL('https://apis.roblox.com/explore-api/v1/get-sorts');
        apiUrl.searchParams.set('sessionId', crypto.randomUUID());

        let games: Game[] = [];
        while (true) {
            const sortsResponse = await fetch(apiUrl);
            if (!sortsResponse.ok) {
                throw new Error(`Failed to fetch sorts: ${sortsResponse.statusText}`);
            }
            const sortsData: { sorts: (FilterSort | GameSort)[]; nextSortsPageToken: string } =
                await sortsResponse.json();

            const gameSorts = sortsData.sorts.filter(
                sort => sort.contentType === 'Games'
            ) as GameSort[];
            for (const sort of gameSorts) {
                games = games.concat(
                    sort.games.map(game => ({
                        universeId: game.universeId,
                        rootPlaceId: game.rootPlaceId,
                        name: game.name
                    }))
                );
            }

            console.log(`Collected ${games.length} games so far`);

            if (!sortsData.nextSortsPageToken) {
                break;
            }
            apiUrl.searchParams.set('sortsPageToken', sortsData.nextSortsPageToken);
        }

        // merge with existing games to preserve attributes
        console.log(`Merging ${games.length} games with existing data`);

        const currentGameListPath = path.join(process.cwd(), 'data', 'games', 'games.json');
        fs.mkdirSync(path.dirname(currentGameListPath), { recursive: true });

        // Load existing games if the file exists
        let existingGames: Game[] = [];
        if (fs.existsSync(currentGameListPath)) {
            existingGames = JSON.parse(fs.readFileSync(currentGameListPath, 'utf-8'));
            console.log(`Found ${existingGames.length} existing games`);
        }

        // Create a map of existing games for efficient lookup
        const existingGameMap = new Map(existingGames.map(g => [g.universeId, g]));

        // Merge new games with existing ones, preserving existing attributes
        const mergedGames: Game[] = [];
        const newGamesSet = new Set(games.map(g => g.universeId));

        // Add all existing games, updating basic info if they're still in the new list
        for (const existingGame of existingGames) {
            if (newGamesSet.has(existingGame.universeId)) {
                // Find the corresponding new game data
                const newGame = games.find(g => g.universeId === existingGame.universeId);
                if (newGame) {
                    // Merge: keep existing attributes but update basic info
                    mergedGames.push({
                        ...existingGame,
                        name: newGame.name,
                        rootPlaceId: newGame.rootPlaceId
                    });
                }
            } else {
                // Game no longer appears in new list, but keep it anyway
                mergedGames.push(existingGame);
            }
        }

        // Add completely new games
        for (const newGame of games) {
            if (!existingGameMap.has(newGame.universeId)) {
                mergedGames.push(newGame);
            }
        }

        // Remove duplicates and sort by universeId for consistency
        const uniqueGames = Array.from(
            new Map(mergedGames.map(g => [g.universeId, g])).values()
        ).sort((a, b) => a.universeId - b.universeId);

        fs.writeFileSync(currentGameListPath, JSON.stringify(uniqueGames, null, 4));
        console.log(
            `Wrote ${uniqueGames.length} games to ${currentGameListPath} (${uniqueGames.length - existingGames.length} new games added)`
        );
    },
    async downloadImages() {
        // Download icon and primary thumbnail for each game
        const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
        if (!fs.existsSync(gamesPath)) {
            console.error('games.json not found. Run gatherGames first.');
            return;
        }
        const games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
        const total = games.length;
        const wait = (ms: number) => new Promise(res => setTimeout(res, ms));
        const batchSize = 50;
        // ICONS: Only batch games that do not already have icon.webp
        const gamesMissingIcon = games.filter(game => {
            const imageDir = path.join(
                process.cwd(),
                'data',
                'games',
                'images',
                String(game.universeId)
            );
            const iconPath = path.join(imageDir, 'icon.webp');
            return !fs.existsSync(iconPath);
        });
        for (let i = 0; i < gamesMissingIcon.length; i += batchSize) {
            const batch = gamesMissingIcon.slice(i, i + batchSize);
            const batchUniverseIds = batch.map(g => g.universeId);
            const batchMap = new Map(batch.map(g => [g.universeId, g]));
            let retry = false;
            let iconRes;
            do {
                retry = false;
                const url = new URL('https://thumbnails.roblox.com/v1/games/icons');
                url.searchParams.set('universeIds', batchUniverseIds.join(','));
                url.searchParams.set('size', '512x512');
                url.searchParams.set('format', 'WebP');
                url.searchParams.set('isCircular', 'false');
                try {
                    iconRes = await fetch(url.toString());
                    if (iconRes.status === 429) {
                        console.warn(
                            `[${i + 1}-${i + batch.length}/${gamesMissingIcon.length}] Icon API rate limited (429). Waiting 30 seconds before retrying...`
                        );
                        await wait(30000);
                        retry = true;
                    }
                } catch (e) {
                    console.error(
                        `[${i + 1}-${i + batch.length}/${gamesMissingIcon.length}] Failed to fetch icon batch:`,
                        e
                    );
                    break;
                }
            } while (retry);
            if (iconRes && iconRes.ok) {
                const iconData = await iconRes.json();
                for (const entry of iconData.data) {
                    const universeId = entry.targetId;
                    const game = batchMap.get(universeId);
                    if (!game) continue;
                    const imageDir = path.join(
                        process.cwd(),
                        'data',
                        'games',
                        'images',
                        String(universeId)
                    );
                    fs.mkdirSync(imageDir, { recursive: true });
                    const iconPath = path.join(imageDir, 'icon.webp');
                    if (fs.existsSync(iconPath)) {
                        console.log(
                            `[${i + 1}-${i + batch.length}/${gamesMissingIcon.length}] Icon already exists for ${universeId}`
                        );
                        continue;
                    }
                    if (entry.imageUrl && entry.state === 'Completed') {
                        let imgRes;
                        let retryImg = false;
                        do {
                            retryImg = false;
                            try {
                                imgRes = await fetch(entry.imageUrl);
                                if (imgRes.status === 429) {
                                    console.warn(
                                        `[${i + 1}-${i + batch.length}/${gamesMissingIcon.length}] Icon image rate limited (429). Waiting 30 seconds before retrying...`
                                    );
                                    await wait(30000);
                                    retryImg = true;
                                }
                            } catch (e) {
                                console.error(
                                    `[${i + 1}-${i + batch.length}/${gamesMissingIcon.length}] Failed to fetch icon image for ${universeId}:`,
                                    e
                                );
                                break;
                            }
                        } while (retryImg);
                        if (imgRes && imgRes.ok) {
                            const buffer = Buffer.from(await imgRes.arrayBuffer());
                            fs.writeFileSync(iconPath, buffer);
                            console.log(
                                `[${i + 1}-${i + batch.length}/${gamesMissingIcon.length}] Downloaded icon for ${universeId}`
                            );
                        }
                    } else {
                        console.warn(
                            `[${i + 1}-${i + batch.length}/${gamesMissingIcon.length}] No valid icon for ${universeId}`
                        );
                    }
                }
            }
        }
        // THUMBNAILS: Only batch games that do not already have thumbnail.webp
        const gamesMissingThumb = games.filter(game => {
            const imageDir = path.join(
                process.cwd(),
                'data',
                'games',
                'images',
                String(game.universeId)
            );
            const thumbPath = path.join(imageDir, 'thumbnail.webp');
            return !fs.existsSync(thumbPath);
        });
        for (let i = 0; i < gamesMissingThumb.length; i += batchSize) {
            const batch = gamesMissingThumb.slice(i, i + batchSize);
            const batchUniverseIds = batch.map(g => g.universeId);
            const batchMap = new Map(batch.map(g => [g.universeId, g]));
            let retry = false;
            let thumbRes;
            do {
                retry = false;
                const url = new URL('https://thumbnails.roblox.com/v1/games/multiget/thumbnails');
                url.searchParams.set('universeIds', batchUniverseIds.join(','));
                url.searchParams.set('size', '768x432');
                url.searchParams.set('format', 'WebP');
                url.searchParams.set('isCircular', 'false');
                try {
                    thumbRes = await fetch(url.toString());
                    if (thumbRes.status === 429) {
                        console.warn(
                            `[${i + 1}-${i + batch.length}/${gamesMissingThumb.length}] Thumbnail API rate limited (429). Waiting 30 seconds before retrying...`
                        );
                        await wait(30000);
                        retry = true;
                    }
                } catch (e) {
                    console.error(
                        `[${i + 1}-${i + batch.length}/${gamesMissingThumb.length}] Failed to fetch thumbnail batch:`,
                        e
                    );
                    break;
                }
            } while (retry);
            if (thumbRes && thumbRes.ok) {
                const thumbData = await thumbRes.json();
                for (const entry of thumbData.data) {
                    const universeId = entry.universeId;
                    const game = batchMap.get(universeId);
                    if (!game) continue;
                    const imageDir = path.join(
                        process.cwd(),
                        'data',
                        'games',
                        'images',
                        String(universeId)
                    );
                    fs.mkdirSync(imageDir, { recursive: true });
                    const thumbPath = path.join(imageDir, 'thumbnail.webp');
                    if (fs.existsSync(thumbPath)) {
                        console.log(
                            `[${i + 1}-${i + batch.length}/${gamesMissingThumb.length}] Thumbnail already exists for ${universeId}`
                        );
                        continue;
                    }
                    const thumb = entry.thumbnails?.[0];
                    if (thumb && thumb.imageUrl && thumb.state === 'Completed') {
                        let imgRes;
                        let retryImg = false;
                        do {
                            retryImg = false;
                            try {
                                imgRes = await fetch(thumb.imageUrl);
                                if (imgRes.status === 429) {
                                    console.warn(
                                        `[${i + 1}-${i + batch.length}/${gamesMissingThumb.length}] Thumbnail image rate limited (429). Waiting 30 seconds before retrying...`
                                    );
                                    await wait(30000);
                                    retryImg = true;
                                }
                            } catch (e) {
                                console.error(
                                    `[${i + 1}-${i + batch.length}/${gamesMissingThumb.length}] Failed to fetch thumbnail image for ${universeId}:`,
                                    e
                                );
                                break;
                            }
                        } while (retryImg);
                        if (imgRes && imgRes.ok) {
                            const buffer = Buffer.from(await imgRes.arrayBuffer());
                            fs.writeFileSync(thumbPath, buffer);
                            console.log(
                                `[${i + 1}-${i + batch.length}/${gamesMissingThumb.length}] Downloaded thumbnail for ${universeId}`
                            );
                        }
                    } else {
                        console.warn(
                            `[${i + 1}-${i + batch.length}/${gamesMissingThumb.length}] No valid thumbnail for ${universeId}`
                        );
                    }
                }
            }
        }
    },
    async downloadDescriptions() {
        // Download descriptions for each game and add to games.json
        const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
        if (!fs.existsSync(gamesPath)) {
            console.error('games.json not found. Run gatherGames first.');
            return;
        }
        let games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
        // summary of inclusion/exclusion breakdown
        const totalGames = games.length;
        const excludedNoDescription = games.filter(
            g =>
                !g.description || (typeof g.description === 'string' && g.description.trim() === '')
        ).length;
        const excludedHasGameplayDesc = games.filter(
            g => g.gameplayDescription && g.gameplayDescription.trim() !== ''
        ).length;
        console.log(`Total games: ${totalGames}`);
        console.log(`Excluded (no description): ${excludedNoDescription}`);
        console.log(`Excluded (already have gameplay descriptions): ${excludedHasGameplayDesc}`);

        const wait = (ms: number) => new Promise(res => setTimeout(res, ms));
        const batchSize = 50;
        // Only batch games that do not already have a description
        const gamesMissingDesc = games.filter(
            g => g.description === undefined || g.description === ''
        );
        const gameMap = new Map(games.map(g => [g.universeId, g]));
        for (let i = 0; i < gamesMissingDesc.length; i += batchSize) {
            const batch = gamesMissingDesc.slice(i, i + batchSize);
            const batchUniverseIds = batch.map(g => g.universeId);
            let retry = false;
            let descRes;
            do {
                retry = false;
                const url = new URL('https://games.roblox.com/v1/games');
                url.searchParams.set('universeIds', batchUniverseIds.join(','));
                try {
                    descRes = await fetch(url.toString());
                    if (descRes.status === 429) {
                        console.warn(
                            `[${i + 1}-${i + batch.length}/${gamesMissingDesc.length}] Description API rate limited (429). Waiting 30 seconds before retrying...`
                        );
                        await wait(30000);
                        retry = true;
                    }
                } catch (e) {
                    console.error(
                        `[${i + 1}-${i + batch.length}/${gamesMissingDesc.length}] Failed to fetch description batch:`,
                        e
                    );
                    break;
                }
            } while (retry);
            if (descRes && descRes.ok) {
                const descData = await descRes.json();
                // Track which universeIds were returned (as strings for robust comparison)
                const returnedIds = new Set(descData.data.map((entry: any) => String(entry.id)));
                for (const entry of descData.data) {
                    const universeId = entry.id;
                    const game = gameMap.get(universeId);
                    if (!game) continue;
                    // Add or update description
                    game.description = entry.description || '';
                    console.log(
                        `[${i + 1}-${i + batch.length}/${gamesMissingDesc.length}] Got description for ${universeId}`
                    );
                }
                // Mark missing universeIds as null (compare as strings)
                for (const universeId of batchUniverseIds) {
                    if (!returnedIds.has(String(universeId))) {
                        const game = gameMap.get(universeId);
                        if (game) {
                            game.description = null;
                            console.warn(
                                `[${i + 1}-${i + batch.length}/${gamesMissingDesc.length}] No description found for ${universeId}, marking as null.`
                            );
                        }
                    }
                }
            }
        }
        // write updated games to file
        fs.writeFileSync(gamesPath, JSON.stringify(Array.from(gameMap.values()), null, 4));
        console.log(`Updated descriptions in ${gamesPath}`);
    },
    async generateGameplayDescriptions() {
        const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
        if (!fs.existsSync(gamesPath)) {
            console.error('games.json not found. Run gatherGames first.');
            return;
        }

        const games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
        // summary of inclusion/exclusion breakdown
        const totalGames = games.length;
        const excludedNoDescription = games.filter(
            g =>
                !g.description || (typeof g.description === 'string' && g.description.trim() === '')
        ).length;
        const excludedHasGameplayDesc = games.filter(
            g => g.gameplayDescription && g.gameplayDescription.trim() !== ''
        ).length;
        console.log(`Total games: ${totalGames}`);
        console.log(`Excluded (no description): ${excludedNoDescription}`);
        console.log(`Excluded (already have gameplay descriptions): ${excludedHasGameplayDesc}`);

        // Only batch games that do not already have a description
        const gamesMissingGameplayDescriptions = games.filter(
            game =>
                game.description &&
                (!game.gameplayDescription || game.gameplayDescription.trim() === '')
        );
        console.log(`Games to generate: ${gamesMissingGameplayDescriptions.length}`);

        if (gamesMissingGameplayDescriptions.length === 0) {
            console.log('No games are missing gameplay descriptions.');
            return;
        }

        console.log(
            `Generating gameplay descriptions for ${gamesMissingGameplayDescriptions.length} games...`
        );

        const model = await client.llm.model(descriptionModel);
        const systemPrompt = await loadSystemPrompt('gameplayAnalysis');

        for (let i = 0; i < gamesMissingGameplayDescriptions.length; i++) {
            const game = gamesMissingGameplayDescriptions[i];
            console.log(
                `[${i + 1}/${gamesMissingGameplayDescriptions.length}] Generating gameplay description for game: ${game.name}`
            );
            try {
                const iconPath = await client.files.prepareImage(
                    path.join(
                        process.cwd(),
                        'data',
                        'games',
                        'images',
                        String(game.universeId),
                        'icon.webp'
                    )
                );
                const thumbnailPath = await client.files.prepareImage(
                    path.join(
                        process.cwd(),
                        'data',
                        'games',
                        'images',
                        String(game.universeId),
                        'thumbnail.webp'
                    )
                );

                const response = await model.respond([
                    {
                        role: 'system',
                        content: systemPrompt
                    },
                    {
                        role: 'user',
                        content: `**Game Title**: ${game.name}\n\n**Game Description**: ${game.description}`,
                        images: [iconPath, thumbnailPath]
                    }
                ]);

                game.gameplayDescription = response.content;
                console.log(
                    `[${i + 1}/${gamesMissingGameplayDescriptions.length}] Generated gameplay description for game: ${game.name}`
                );
            } catch (error) {
                console.error(
                    `[${i + 1}/${gamesMissingGameplayDescriptions.length}] Failed to generate gameplay description for game: ${game.name}`,
                    error
                );
            }
            if ((i + 1) % 10 === 0) {
                fs.writeFileSync(gamesPath, JSON.stringify(games, null, 4));
                console.log(`Saved progress after ${i + 1} gameplay descriptions to ${gamesPath}`);
            }
        }
        // final save
        fs.writeFileSync(gamesPath, JSON.stringify(games, null, 4));
        console.log(
            `Updated gameplay descriptions for ${gamesMissingGameplayDescriptions.length} games in ${gamesPath}`
        );
    },
    async countGames() {
        const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
        if (!fs.existsSync(gamesPath)) {
            console.error('games.json not found. Run gatherGames first.');
            return;
        }
        const games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
        console.log(`Total games: ${games.length}`);
        const withDescriptions = games.filter(
            g => g.description && g.description.trim() !== ''
        ).length;
        console.log(`Games with descriptions: ${withDescriptions}`);
        const withGameplayDescriptions = games.filter(
            g => g.gameplayDescription && g.gameplayDescription.trim() !== ''
        ).length;
        console.log(`Games with gameplay descriptions: ${withGameplayDescriptions}`);
    },
    async generateEmbeddings() {
        // load embedding model
        const model = await client.embedding.model(embeddingModel);

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
                const embeddings = await model.embed(descriptions);
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
                fs.writeFileSync(embeddingsPath, JSON.stringify(existingEmbeddings, null, 4));
                console.log(
                    `Saved progress after ${Math.min(i + batchSize, gamesWithDescriptions.length)} embeddings to ${embeddingsPath}`
                );
            }
        }

        // Final save
        fs.writeFileSync(embeddingsPath, JSON.stringify(existingEmbeddings, null, 4));
        console.log(
            `Generated embeddings for ${gamesWithDescriptions.length} games in ${embeddingsPath}`
        );
    },
    async findSimilarGames() {
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
        const universeId = parseInt(game, 10);
        if (!(universeId in embeddings)) {
            console.error(`No embeddings found for game with universeId ${universeId}.`);
            return;
        }
        const targetEmbedding = embeddings[universeId];

        // run cosine similarity search
        const cosineSimilarity = (a: number[], b: number[]) => {
            const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
            const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
            const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
            return dotProduct / (normA * normB);
        };
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
};

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
