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
};

type GameSort = {
    contentType: 'Games';
    games: Game[];
};

// constants
const descriptionModel = 'google/gemma-3-4b';

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

        // dump to file
        console.log(`Writing ${games.length} games to file`);

        // merge with existing games
        const currentGameListPath = path.join(process.cwd(), 'data', 'games', 'games.json');
        let currentGameList: Game[] = [];
        if (fs.existsSync(currentGameListPath)) {
            const fileContent = fs.readFileSync(currentGameListPath, 'utf-8').trim();
            if (fileContent.length > 0) {
                currentGameList = JSON.parse(fileContent) as Game[];
            }
        }
        const existingGameIds = new Set(currentGameList.map(game => game.universeId));
        const newGames = games.filter(game => !existingGameIds.has(game.universeId));
        const mergedGames = currentGameList.concat(newGames);

        // ensure output directory exists
        fs.mkdirSync(path.dirname(currentGameListPath), { recursive: true });

        // write merged games to file
        fs.writeFileSync(currentGameListPath, JSON.stringify(mergedGames, null));

        console.log(`Wrote ${newGames.length} new games to ${currentGameListPath}`);
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
        fs.writeFileSync(gamesPath, JSON.stringify(Array.from(gameMap.values()), null));
        console.log(`Updated descriptions in ${gamesPath}`);
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
