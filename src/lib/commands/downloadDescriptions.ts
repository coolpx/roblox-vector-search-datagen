import fs from 'fs';
import path from 'path';
import { fetchRobloxGameDetailsBatch } from './roblox';

export async function downloadDescriptions() {
    // Download descriptions for each game and add to games.json
    const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
    if (!fs.existsSync(gamesPath)) {
        console.error('games.json not found. Run gatherGames first.');
        return;
    }
    const games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
    const hasDescription = (game: Game) =>
        typeof game.description === 'string' && game.description.trim() !== '';
    const needsDescription = (game: Game) =>
        game.description === undefined ||
        (typeof game.description === 'string' && game.description.trim() === '');
    const needsPlayerCount = (game: Game) => game.playerCount === undefined;

    const totalGames = games.length;
    const missingDescriptions = games.filter(needsDescription).length;
    const missingPlayerCounts = games.filter(needsPlayerCount).length;
    const withDescriptions = games.filter(hasDescription).length;
    console.log(`Total games: ${totalGames}`);
    console.log(`Games with descriptions: ${withDescriptions}`);
    console.log(`Games missing descriptions: ${missingDescriptions}`);
    console.log(`Games missing player counts: ${missingPlayerCounts}`);

    const gamesMissingDesc = games.filter(game => needsDescription(game) || needsPlayerCount(game));
    if (gamesMissingDesc.length === 0) {
        console.log(
            'All games already have descriptions or known blank descriptions and player counts.'
        );
        return;
    }

    console.log(`Fetching details for ${gamesMissingDesc.length} games...`);

    const gameMap = new Map(games.map(g => [g.universeId, g]));
    for (let i = 0; i < gamesMissingDesc.length; i += 50) {
        const batch = gamesMissingDesc.slice(i, i + 50);
        const batchUniverseIds = batch.map(g => g.universeId);
        const rangeLabel = `[${i + 1}-${i + batch.length}/${gamesMissingDesc.length}]`;
        const gameDetails = await fetchRobloxGameDetailsBatch(batchUniverseIds, rangeLabel);
        if (!gameDetails) {
            continue;
        }

        const returnedIds = new Set(gameDetails.map(entry => String(entry.id)));
        for (const entry of gameDetails) {
            const universeId = entry.id;
            const game = gameMap.get(universeId);
            if (!game) continue;

            const description =
                typeof entry.description === 'string' && entry.description.trim() !== ''
                    ? entry.description
                    : null;
            game.description = description;
            game.playerCount = typeof entry.playing === 'number' ? entry.playing : 0;
            console.log(`${rangeLabel} Got details for ${universeId}`);
        }

        for (const universeId of batchUniverseIds) {
            if (returnedIds.has(String(universeId))) {
                continue;
            }

            const game = gameMap.get(universeId);
            if (game) {
                if (needsDescription(game)) {
                    game.description = null;
                }
                console.warn(`${rangeLabel} No game details returned for ${universeId}.`);
            }
        }
    }
    // write updated games to file
    fs.writeFileSync(gamesPath, JSON.stringify(Array.from(gameMap.values()), null, 4));
    console.log(`Updated descriptions in ${gamesPath}`);
}
