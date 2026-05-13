import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export async function gatherGames(): Promise<number> {
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
    const uniqueGames = Array.from(new Map(mergedGames.map(g => [g.universeId, g])).values()).sort(
        (a, b) => a.universeId - b.universeId
    );

    fs.writeFileSync(currentGameListPath, JSON.stringify(uniqueGames, null, 4));
    console.log(
        `Wrote ${uniqueGames.length} games to ${currentGameListPath} (${uniqueGames.length - existingGames.length} new games added)`
    );

    // Return the number of games added
    return uniqueGames.length - existingGames.length;
}
