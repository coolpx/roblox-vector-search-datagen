import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

type SearchGameContent = {
    universeId: number;
    name: string;
    description?: string;
    playerCount: number;
    rootPlaceId: number;
};

type OmniSearchResponse = {
    searchResults?: {
        contentGroupType: string;
        topicId: string;
        contents?: SearchGameContent[];
    }[];
};

export async function gatherGamesFromSearch(query?: string): Promise<number> {
    const searchQuery = (query ?? process.argv.slice(3).join(' ')).trim();
    if (!searchQuery) {
        console.error(
            'Please provide a Roblox search query. Example: npm run interactive -- gatherGamesFromSearch "obby"'
        );
        return 0;
    }

    console.log(`Searching Roblox games for "${searchQuery}"`);

    const apiUrl = new URL('https://apis.roblox.com/search-api/omni-search');
    apiUrl.searchParams.set('searchQuery', searchQuery);
    apiUrl.searchParams.set('sessionId', crypto.randomUUID());

    const searchResponse = await fetch(apiUrl);
    if (!searchResponse.ok) {
        throw new Error(`Failed to fetch Roblox search results: ${searchResponse.statusText}`);
    }

    const searchData = (await searchResponse.json()) as OmniSearchResponse;
    const games: Game[] =
        searchData.searchResults
            ?.filter(result => result.contentGroupType === 'Game')
            .flatMap(result => result.contents ?? [])
            .map(game => ({
                universeId: game.universeId,
                rootPlaceId: game.rootPlaceId,
                name: game.name,
                playerCount: game.playerCount
            })) ?? [];

    console.log(`Found ${games.length} games in first search results page`);

    const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
    fs.mkdirSync(path.dirname(gamesPath), { recursive: true });

    let existingGames: Game[] = [];
    if (fs.existsSync(gamesPath)) {
        existingGames = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
        console.log(`Found ${existingGames.length} existing games`);
    }

    const existingGameMap = new Map(existingGames.map(g => [g.universeId, g]));
    const mergedGames: Game[] = [];
    const newGamesSet = new Set(games.map(g => g.universeId));

    for (const existingGame of existingGames) {
        if (newGamesSet.has(existingGame.universeId)) {
            const newGame = games.find(g => g.universeId === existingGame.universeId);
            if (newGame) {
                mergedGames.push({
                    ...existingGame,
                    name: newGame.name,
                    rootPlaceId: newGame.rootPlaceId,
                    playerCount: newGame.playerCount
                });
            }
        } else {
            mergedGames.push(existingGame);
        }
    }

    for (const newGame of games) {
        if (!existingGameMap.has(newGame.universeId)) {
            mergedGames.push(newGame);
        }
    }

    const uniqueGames = Array.from(new Map(mergedGames.map(g => [g.universeId, g])).values()).sort(
        (a, b) => a.universeId - b.universeId
    );

    fs.writeFileSync(gamesPath, JSON.stringify(uniqueGames, null, 4));
    console.log(
        `Wrote ${uniqueGames.length} games to ${gamesPath} (${uniqueGames.length - existingGames.length} new games added)`
    );

    return uniqueGames.length - existingGames.length;
}
