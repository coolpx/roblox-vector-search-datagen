import fs from 'fs';
import path from 'path';
import { fetchRobloxGameDetailsBatch } from './roblox';

export async function pruneGames() {
    const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
    if (!fs.existsSync(gamesPath)) {
        console.error('games.json not found. Run gatherGames first.');
        return;
    }

    const games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
    const gameMap = new Map(games.map(g => [g.universeId, g]));

    console.log(`Checking ${games.length} games for valid Roblox game details...`);

    let prunedCount = 0;
    for (let i = 0; i < games.length; i += 50) {
        const batch = games.slice(i, i + 50);
        const batchUniverseIds = batch.map(g => g.universeId);
        const rangeLabel = `[${i + 1}-${i + batch.length}/${games.length}]`;
        const gameDetails = await fetchRobloxGameDetailsBatch(batchUniverseIds, rangeLabel);
        if (!gameDetails) {
            continue;
        }

        const returnedIds = new Set(gameDetails.map(entry => String(entry.id)));
        for (const universeId of batchUniverseIds) {
            if (returnedIds.has(String(universeId))) {
                continue;
            }

            if (gameMap.delete(universeId)) {
                prunedCount++;
                console.log(`${rangeLabel} Pruned ${universeId}`);
            }
        }
    }

    fs.writeFileSync(gamesPath, JSON.stringify(Array.from(gameMap.values()), null, 4));
    console.log(`Pruned ${prunedCount} games from ${gamesPath}`);
}
