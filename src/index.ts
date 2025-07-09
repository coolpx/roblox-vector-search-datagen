// modules
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import OpenAI from 'openai';
import { LMStudioClient } from '@lmstudio/sdk';

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

const openaiDescriptionModel = 'gpt-4o-mini';

// functions
async function loadSystemPrompt(name: 'gameplayAnalysis') {
    return fs.readFileSync(`./prompts/${name}.txt`, 'utf-8');
}

// command registry
const commands: Record<string, () => Promise<void>> = {
    // data gathering
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
    async gatherGamesRolimons() {
        console.log('Gathering games from Rolimons...');

        // download games page from rolimons
        const rolimonsResponse = await fetch('https://rolimons.com/games');
        if (!rolimonsResponse.ok) {
            throw new Error(`Failed to fetch Rolimons games page: ${rolimonsResponse.statusText}`);
        }
        const rolimonsHtml = await rolimonsResponse.text();

        // get games list from html
        const gamesList: { [placeId: number]: { name: string; icon_url: string } } = JSON.parse(
            rolimonsHtml
                .split('var games = ')[1]
                .split('document.addEventListener')[0]
                .trim()
                .slice(0, -1)
        );
        if (!gamesList) {
            throw new Error('Failed to parse games list from Rolimons HTML');
        }

        console.log(
            `Found ${Object.keys(gamesList).length} games on Rolimons, gathering universe IDs...`
        );

        // get universe IDs from place IDs
        const games: Game[] = [];
        let i = 0;
        const total = Object.keys(gamesList).length;
        const wait = (ms: number) => new Promise(res => setTimeout(res, ms));

        for (const [placeId, gameData] of Object.entries(gamesList)) {
            console.log(`[${i++}/${total}] Gathering universe ID for place ID ${placeId}`);

            let retry = false;
            let universeIdResponse;
            do {
                retry = false;
                try {
                    universeIdResponse = await fetch(
                        `https://apis.roblox.com/universes/v1/places/${placeId}/universe`
                    );
                    if (universeIdResponse.status === 429) {
                        console.warn(
                            `[${i}/${total}] Universe ID API rate limited (429) for place ID ${placeId}. Waiting 30 seconds before retrying...`
                        );
                        await wait(30000);
                        retry = true;
                    }
                } catch (e) {
                    console.error(
                        `[${i}/${total}] Failed to fetch universe ID for place ID ${placeId}:`,
                        e
                    );
                    break;
                }
            } while (retry);

            if (!universeIdResponse || !universeIdResponse.ok) {
                console.warn(
                    `Failed to fetch universe ID for place ID ${placeId}: ${universeIdResponse?.statusText || 'Network error'}`
                );
                continue;
            }

            const universeData = await universeIdResponse.json();
            const universeId = universeData.universeId;
            if (universeId) {
                games.push({
                    universeId,
                    rootPlaceId: parseInt(placeId),
                    name: gameData.name
                });
            } else {
                console.warn(`No universe ID found for place ID ${placeId}`);
            }
        }

        // merge with existing games to preserve attributes
        console.log(`Merging ${games.length} games with existing data`);

        const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
        fs.mkdirSync(path.dirname(gamesPath), { recursive: true });

        // Load existing games if the file exists
        let existingGames: Game[] = [];
        if (fs.existsSync(gamesPath)) {
            existingGames = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
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

        fs.writeFileSync(gamesPath, JSON.stringify(uniqueGames, null, 4));
        console.log(
            `Wrote ${uniqueGames.length} games to ${gamesPath} (${uniqueGames.length - existingGames.length} new games added)`
        );
        console.log('Gathering games from Rolimons completed.');
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
    // data utilities
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
        const universeId = parseInt(game);
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
    },
    async clearGameplayDescriptions() {
        // Clear gameplay descriptions from games.json
        const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
        if (!fs.existsSync(gamesPath)) {
            console.error('games.json not found. Run gatherGames first.');
            return;
        }
        const games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));

        // Clear gameplay descriptions
        for (const game of games) {
            game.gameplayDescription = undefined;
        }

        // Write updated games to file
        fs.writeFileSync(gamesPath, JSON.stringify(games, null, 4));
        console.log(`Cleared gameplay descriptions in ${gamesPath}`);
    },
    // local backend
    async generateGameplayDescriptions() {
        const client = new LMStudioClient();

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
    async generateEmbeddings() {
        // load embedding model
        const client = new LMStudioClient();

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
    },
    // openai backend
    async prepareOpenAIGameplayDescriptionBatch() {
        // read games.json
        const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
        if (!fs.existsSync(gamesPath)) {
            console.error('games.json not found. Run gatherGames first.');
            return;
        }

        const games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));

        // filter games that have a description but no gameplay description
        const gamesMissingGameplayDescriptions = games.filter(
            game =>
                game.description &&
                (!game.gameplayDescription || game.gameplayDescription.trim() === '')
        );

        if (gamesMissingGameplayDescriptions.length === 0) {
            console.log('No games are missing gameplay descriptions.');
            return;
        }

        console.log(
            `Preparing OpenAI batch for ${gamesMissingGameplayDescriptions.length} games...`
        );

        const outputDir = path.join(process.cwd(), 'data', 'games', 'openai_batches');
        fs.mkdirSync(outputDir, { recursive: true });

        const systemPrompt = await loadSystemPrompt('gameplayAnalysis');

        // Batch processing variables
        let processedCount = 0;
        let batchNumber = 1;
        const batchSize = 500;
        let currentBatchCount = 0;
        let writeStream: fs.WriteStream;

        // Initialize first batch file
        const getBatchPath = (batchNum: number) =>
            path.join(
                outputDir,
                `openai_gameplay_batch_${batchNum.toString().padStart(3, '0')}.jsonl`
            );

        writeStream = fs.createWriteStream(getBatchPath(batchNumber), { flags: 'w' });
        console.log(`Starting batch ${batchNumber}: ${getBatchPath(batchNumber)}`);

        for (const game of gamesMissingGameplayDescriptions) {
            // load icon and thumbnail images as base64
            const iconPath = path.join(
                process.cwd(),
                'data',
                'games',
                'images',
                game.universeId.toString(),
                'icon.webp'
            );
            const thumbnailPath = path.join(
                process.cwd(),
                'data',
                'games',
                'images',
                game.universeId.toString(),
                'thumbnail.webp'
            );
            if (!fs.existsSync(iconPath)) {
                console.warn(
                    `Icon not found for game ${game.universeId} (${game.name}), skipping...`
                );
                continue;
            }
            if (!fs.existsSync(thumbnailPath)) {
                console.warn(
                    `Thumbnail not found for game ${game.universeId} (${game.name}), skipping...`
                );
                continue;
            }

            // create request
            const request: {
                custom_id: string;
                method: 'POST';
                url: '/v1/chat/completions';
                body: OpenAI.ChatCompletionCreateParams;
            } = {
                custom_id: `gameplay_description_${game.universeId}`,
                method: 'POST',
                url: '/v1/chat/completions',
                body: {
                    model: openaiDescriptionModel,
                    messages: [
                        {
                            role: 'system',
                            content: systemPrompt
                        },
                        {
                            role: 'user',
                            content: [
                                {
                                    type: 'image_url',
                                    image_url: {
                                        url: `https://coolpixels.net/assets/robloxImages/${game.universeId}/icon.webp`,
                                        detail: 'low'
                                    }
                                },
                                {
                                    type: 'image_url',
                                    image_url: {
                                        url: `https://coolpixels.net/assets/robloxImages/${game.universeId}/thumbnail.webp`,
                                        detail: 'low'
                                    }
                                },
                                {
                                    type: 'text',
                                    text: `**Game Title**: ${game.name}\n\n**Game Description**: ${game.description}`
                                }
                            ]
                        }
                    ]
                }
            };

            // Write line to file immediately
            const line = JSON.stringify(request) + '\n';
            writeStream.write(line);
            processedCount++;
            currentBatchCount++;

            // Check if we need to start a new batch file
            if (
                currentBatchCount >= batchSize &&
                processedCount < gamesMissingGameplayDescriptions.length
            ) {
                writeStream.end();
                console.log(`Completed batch ${batchNumber}: ${currentBatchCount} games`);

                batchNumber++;
                currentBatchCount = 0;
                writeStream = fs.createWriteStream(getBatchPath(batchNumber), { flags: 'w' });
                console.log(`Starting batch ${batchNumber}: ${getBatchPath(batchNumber)}`);
            }

            // Log progress every 100 games
            if (processedCount % 100 === 0) {
                console.log(
                    `Processed ${processedCount}/${gamesMissingGameplayDescriptions.length} games...`
                );
            }
        }

        // Close the write stream
        writeStream.end();
        console.log(`Completed batch ${batchNumber}: ${currentBatchCount} games`);

        console.log(
            `Prepared OpenAI batch for ${processedCount} games across ${batchNumber} batch files in ${outputDir}`
        );
    },
    async importOpenAIGameplayDescriptions() {
        // Import gameplay descriptions from OpenAI batch output files
        const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
        if (!fs.existsSync(gamesPath)) {
            console.error('games.json not found. Run gatherGames first.');
            return;
        }

        const games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
        const gameMap = new Map(games.map(g => [g.universeId, g]));

        const outputDir = path.join(process.cwd(), 'data', 'games', 'openai_batch_output');
        if (!fs.existsSync(outputDir)) {
            console.error('openai_batch_output directory not found.');
            return;
        }

        // Get all JSONL files in the output directory
        const outputFiles = fs.readdirSync(outputDir).filter(file => file.endsWith('.jsonl'));
        if (outputFiles.length === 0) {
            console.error('No JSONL files found in openai_batch_output directory.');
            return;
        }

        console.log(`Found ${outputFiles.length} batch output files to process...`);

        let totalProcessed = 0;
        let totalUpdated = 0;
        let totalErrors = 0;

        for (const file of outputFiles) {
            const filePath = path.join(outputDir, file);
            console.log(`Processing file: ${file}`);

            try {
                const fileContent = fs.readFileSync(filePath, 'utf-8');
                const lines = fileContent.trim().split('\n');

                let fileProcessed = 0;
                let fileUpdated = 0;
                let fileErrors = 0;

                for (const line of lines) {
                    if (!line.trim()) continue;

                    try {
                        const batchResponse = JSON.parse(line);
                        totalProcessed++;
                        fileProcessed++;

                        // Extract universe ID from custom_id
                        const customId = batchResponse.custom_id;
                        if (!customId || !customId.startsWith('gameplay_description_')) {
                            console.warn(`Invalid custom_id format: ${customId}`);
                            totalErrors++;
                            fileErrors++;
                            continue;
                        }

                        const universeId = parseInt(customId.replace('gameplay_description_', ''));
                        const game = gameMap.get(universeId);

                        if (!game) {
                            console.warn(`Game not found for universe ID: ${universeId}`);
                            totalErrors++;
                            fileErrors++;
                            continue;
                        }

                        // Check if the response was successful
                        if (batchResponse.error) {
                            console.warn(
                                `Error in batch response for game ${universeId}: ${batchResponse.error}`
                            );
                            totalErrors++;
                            fileErrors++;
                            continue;
                        }

                        if (batchResponse.response?.status_code !== 200) {
                            console.warn(
                                `Non-200 status code for game ${universeId}: ${batchResponse.response?.status_code}`
                            );
                            totalErrors++;
                            fileErrors++;
                            continue;
                        }

                        // Extract the gameplay description from the response
                        const choices = batchResponse.response?.body?.choices;
                        if (!choices || choices.length === 0) {
                            console.warn(`No choices in response for game ${universeId}`);
                            totalErrors++;
                            fileErrors++;
                            continue;
                        }

                        const gameplayDescription = choices[0]?.message?.content;
                        if (!gameplayDescription) {
                            console.warn(`No content in response for game ${universeId}`);
                            totalErrors++;
                            fileErrors++;
                            continue;
                        }

                        // Update the game with the gameplay description
                        game.gameplayDescription = gameplayDescription.trim();
                        totalUpdated++;
                        fileUpdated++;

                        console.log(
                            `Updated gameplay description for game ${universeId} (${game.name})`
                        );
                    } catch (error) {
                        console.error(`Error parsing line in file ${file}:`, error);
                        totalErrors++;
                        fileErrors++;
                    }
                }

                console.log(
                    `File ${file}: Processed ${fileProcessed}, Updated ${fileUpdated}, Errors ${fileErrors}`
                );
            } catch (error) {
                console.error(`Error reading file ${file}:`, error);
            }
        }

        // Save the updated games
        fs.writeFileSync(gamesPath, JSON.stringify(games, null, 4));

        console.log(`\nImport completed:`);
        console.log(`Total responses processed: ${totalProcessed}`);
        console.log(`Games updated: ${totalUpdated}`);
        console.log(`Errors: ${totalErrors}`);
        console.log(`Updated games saved to: ${gamesPath}`);
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
