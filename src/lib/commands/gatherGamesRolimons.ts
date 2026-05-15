import fs from 'fs';
import path from 'path';
import { type RobloxPlaceDetail } from './roblox';
import 'dotenv/config';

export async function gatherGamesRolimons() {
    console.log('Gathering games from Rolimons...');
    const roblosecurity = process.env.ROBLOSECURITY;
    if (roblosecurity) {
        console.log('Loaded ROBLOSECURITY cookie for Roblox place detail requests.');
    } else {
        console.warn(
            'No ROBLOSECURITY found in .env or process.env. Falling back to unauthenticated universe ID lookup.'
        );
    }

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

    console.log(`Found ${Object.keys(gamesList).length} games on Rolimons.`);

    const games: Game[] = [];
    const placeIds = Object.keys(gamesList);
    const total = placeIds.length;
    const wait = (ms: number) => new Promise(res => setTimeout(res, ms));

    async function fetchUniverseIdWithFallback(placeId: string): Promise<number | undefined> {
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
                        `Universe ID API rate limited (429) for place ID ${placeId}. Waiting 30 seconds before retrying...`
                    );
                    await wait(30000);
                    retry = true;
                }
            } catch (e) {
                console.error(`Failed to fetch universe ID for place ID ${placeId}:`, e);
                return undefined;
            }
        } while (retry);

        if (!universeIdResponse || !universeIdResponse.ok) {
            console.warn(
                `Failed to fetch universe ID for place ID ${placeId}: ${universeIdResponse?.statusText || 'Network error'}`
            );
            return undefined;
        }

        const universeData = await universeIdResponse.json();
        return universeData.universeId;
    }

    if (roblosecurity) {
        const batchSize = 50;
        console.log(`Gathering Roblox place details in batches of ${batchSize}...`);

        async function requestPlaceDetails(batchPlaceIds: string[]): Promise<Response | undefined> {
            const placeIdParams = batchPlaceIds.map(placeId => `placeIds=${placeId}`).join('&');
            const url = `https://games.roblox.com/v1/games/multiget-place-details?${placeIdParams}`;

            let retry = false;
            let placeDetailsResponse;
            do {
                retry = false;
                try {
                    placeDetailsResponse = await fetch(url, {
                        headers: {
                            Cookie: `.ROBLOSECURITY=${roblosecurity!}`
                        }
                    });
                    if (placeDetailsResponse.status === 429) {
                        console.warn(
                            `Place details API rate limited (429). Waiting 30 seconds before retrying...`
                        );
                        await wait(30000);
                        retry = true;
                    }
                } catch (e) {
                    console.error('Failed to fetch place details batch:', e);
                    return undefined;
                }
            } while (retry);

            return placeDetailsResponse;
        }

        async function getPlaceDetailsBatch(
            batchPlaceIds: string[],
            rangeLabel: string
        ): Promise<RobloxPlaceDetail[]> {
            const placeDetailsResponse = await requestPlaceDetails(batchPlaceIds);

            if (placeDetailsResponse?.ok) {
                return (await placeDetailsResponse.json()) as RobloxPlaceDetail[];
            }

            if (placeDetailsResponse?.status === 400 && batchPlaceIds.length > 1) {
                const responseBody = await placeDetailsResponse.text();
                console.warn(
                    `${rangeLabel} Batch returned 400. Splitting to isolate bad place IDs. ${responseBody}`
                );
                const midpoint = Math.ceil(batchPlaceIds.length / 2);
                const firstHalf = await getPlaceDetailsBatch(
                    batchPlaceIds.slice(0, midpoint),
                    rangeLabel
                );
                const secondHalf = await getPlaceDetailsBatch(
                    batchPlaceIds.slice(midpoint),
                    rangeLabel
                );
                return firstHalf.concat(secondHalf);
            }

            const responseBody = placeDetailsResponse
                ? await placeDetailsResponse.text()
                : 'Network error';
            console.warn(
                `${rangeLabel} Failed to fetch place details: ${placeDetailsResponse?.status || 'No status'} ${placeDetailsResponse?.statusText || 'Network error'} ${responseBody}`
            );

            if (batchPlaceIds.length === 1) {
                const placeId = batchPlaceIds[0];
                console.warn(`Falling back to universe ID lookup for place ID ${placeId}`);
                const universeId = await fetchUniverseIdWithFallback(placeId);
                return universeId
                    ? [
                          {
                              placeId: parseInt(placeId),
                              universeId
                          }
                      ]
                    : [];
            }

            return [];
        }

        for (let i = 0; i < placeIds.length; i += batchSize) {
            const batchPlaceIds = placeIds.slice(i, i + batchSize);
            const rangeLabel = `[${i + 1}-${Math.min(i + batchSize, total)}/${total}]`;
            console.log(`${rangeLabel} Gathering place details`);

            const placeDetails = await getPlaceDetailsBatch(batchPlaceIds, rangeLabel);

            for (const placeDetail of placeDetails) {
                const placeId = placeDetail.placeId;
                const gameData = gamesList[placeId];
                if (!gameData) {
                    console.warn(`No Rolimons game data found for place ID ${placeId}`);
                    continue;
                }

                if (!placeDetail.universeId) {
                    console.warn(`No universe ID found for place ID ${placeId}`);
                    continue;
                }

                games.push({
                    universeId: placeDetail.universeId,
                    rootPlaceId: placeId,
                    name: placeDetail.name || gameData.name,
                    description: placeDetail.description || ''
                });
            }
        }
    } else {
        console.log('Gathering universe IDs with unauthenticated fallback endpoint...');

        for (const [index, [placeId, gameData]] of Object.entries(gamesList).entries()) {
            console.log(`[${index + 1}/${total}] Gathering universe ID for place ID ${placeId}`);
            const universeId = await fetchUniverseIdWithFallback(placeId);
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
                    rootPlaceId: newGame.rootPlaceId,
                    description: newGame.description ?? existingGame.description
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
    const uniqueGames = Array.from(new Map(mergedGames.map(g => [g.universeId, g])).values()).sort(
        (a, b) => a.universeId - b.universeId
    );

    fs.writeFileSync(gamesPath, JSON.stringify(uniqueGames, null, 4));
    console.log(
        `Wrote ${uniqueGames.length} games to ${gamesPath} (${uniqueGames.length - existingGames.length} new games added)`
    );
    console.log('Gathering games from Rolimons completed.');
}
