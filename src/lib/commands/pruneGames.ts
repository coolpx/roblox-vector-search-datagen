import fs from 'fs';
import path from 'path';
import { fetchRobloxGameDetailsBatch } from './roblox';

type PruneOptions = {
    robloxMissing: boolean;
    missingEmbeddings: boolean;
    orphanEmbeddings: boolean;
    zeroPlayers: boolean;
    missingPlayerCount: boolean;
    emptyDescription: boolean;
    emptyGameplayDescription: boolean;
    dryRun: boolean;
};

function printHelp() {
    console.log(`Usage: npm run interactive -- pruneGames [options]

Options:
  --roblox-missing              Prune games missing from Roblox details API (default)
  --missing-embeddings          Prune games without an embedding
  --orphan-embeddings           Prune embeddings without a matching game
  --zero-players                Prune games with playerCount === 0
  --missing-player-count        Prune games without playerCount
  --empty-description           Prune games without description
  --empty-gameplay-description  Prune games without gameplayDescription
  --all-local                   Run all non-network pruning checks
  --dry-run                     Print prune counts without writing files
  --help                        Show this help
`);
}

function parsePruneOptions(args: string[]): PruneOptions | null {
    const options: PruneOptions = {
        robloxMissing: false,
        missingEmbeddings: false,
        orphanEmbeddings: false,
        zeroPlayers: false,
        missingPlayerCount: false,
        emptyDescription: false,
        emptyGameplayDescription: false,
        dryRun: false
    };

    for (const arg of args) {
        switch (arg) {
            case '--roblox-missing':
                options.robloxMissing = true;
                break;
            case '--missing-embeddings':
                options.missingEmbeddings = true;
                break;
            case '--orphan-embeddings':
                options.orphanEmbeddings = true;
                break;
            case '--zero-players':
                options.zeroPlayers = true;
                break;
            case '--missing-player-count':
                options.missingPlayerCount = true;
                break;
            case '--empty-description':
                options.emptyDescription = true;
                break;
            case '--empty-gameplay-description':
                options.emptyGameplayDescription = true;
                break;
            case '--all-local':
                options.missingEmbeddings = true;
                options.orphanEmbeddings = true;
                options.zeroPlayers = true;
                options.missingPlayerCount = true;
                options.emptyDescription = true;
                options.emptyGameplayDescription = true;
                break;
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--help':
            case '-h':
                printHelp();
                return null;
            default:
                console.error(`Unknown option: ${arg}`);
                printHelp();
                return null;
        }
    }

    if (
        !options.missingEmbeddings &&
        !options.orphanEmbeddings &&
        !options.zeroPlayers &&
        !options.missingPlayerCount &&
        !options.emptyDescription &&
        !options.emptyGameplayDescription
    ) {
        options.robloxMissing = true;
    }

    return options;
}

function hasEmptyText(value: string | null | undefined) {
    return typeof value !== 'string' || value.trim() === '';
}

export async function pruneGames() {
    const options = parsePruneOptions(process.argv.slice(3));
    if (!options) {
        return;
    }

    const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
    if (!fs.existsSync(gamesPath)) {
        console.error('games.json not found. Run gatherGames first.');
        return;
    }

    const embeddingsPath = path.join(process.cwd(), 'data', 'games', 'embeddings.json');
    const shouldLoadEmbeddings = options.missingEmbeddings || options.orphanEmbeddings;
    if (shouldLoadEmbeddings && !fs.existsSync(embeddingsPath)) {
        console.error('embeddings.json not found. Run generateEmbeddings first.');
        return;
    }

    const games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
    const gameMap = new Map(games.map(g => [g.universeId, g]));
    const embeddings: Record<string, number[]> = shouldLoadEmbeddings
        ? JSON.parse(fs.readFileSync(embeddingsPath, 'utf-8'))
        : {};
    const embeddingIds = new Set(Object.keys(embeddings));

    const deleteGame = (universeId: number, reason: string) => {
        if (!gameMap.delete(universeId)) {
            return false;
        }

        console.log(`Pruned ${universeId}: ${reason}`);
        return true;
    };

    const localPruneCounts = {
        missingEmbeddings: 0,
        zeroPlayers: 0,
        missingPlayerCount: 0,
        emptyDescription: 0,
        emptyGameplayDescription: 0,
        orphanEmbeddings: 0
    };

    for (const game of games) {
        if (options.missingEmbeddings && !embeddingIds.has(String(game.universeId))) {
            if (deleteGame(game.universeId, 'missing embedding')) {
                localPruneCounts.missingEmbeddings++;
            }
            continue;
        }

        if (options.zeroPlayers && game.playerCount === 0) {
            if (deleteGame(game.universeId, 'zero players')) {
                localPruneCounts.zeroPlayers++;
            }
            continue;
        }

        if (options.missingPlayerCount && game.playerCount === undefined) {
            if (deleteGame(game.universeId, 'missing playerCount')) {
                localPruneCounts.missingPlayerCount++;
            }
            continue;
        }

        if (options.emptyDescription && hasEmptyText(game.description)) {
            if (deleteGame(game.universeId, 'empty description')) {
                localPruneCounts.emptyDescription++;
            }
            continue;
        }

        if (options.emptyGameplayDescription && hasEmptyText(game.gameplayDescription)) {
            if (deleteGame(game.universeId, 'empty gameplayDescription')) {
                localPruneCounts.emptyGameplayDescription++;
            }
        }
    }

    if (options.orphanEmbeddings) {
        for (const universeId of Object.keys(embeddings)) {
            if (gameMap.has(Number(universeId))) {
                continue;
            }

            delete embeddings[universeId];
            localPruneCounts.orphanEmbeddings++;
            console.log(`Pruned embedding ${universeId}: missing game`);
        }
    }

    const localPrunedCount =
        localPruneCounts.missingEmbeddings +
        localPruneCounts.zeroPlayers +
        localPruneCounts.missingPlayerCount +
        localPruneCounts.emptyDescription +
        localPruneCounts.emptyGameplayDescription;

    let robloxPrunedCount = 0;
    if (options.robloxMissing) {
        const remainingGames = Array.from(gameMap.values());
        console.log(`Checking ${remainingGames.length} games for valid Roblox game details...`);

        for (let i = 0; i < remainingGames.length; i += 50) {
            const batch = remainingGames.slice(i, i + 50);
            const batchUniverseIds = batch.map(g => g.universeId);
            const rangeLabel = `[${i + 1}-${i + batch.length}/${remainingGames.length}]`;
            const gameDetails = await fetchRobloxGameDetailsBatch(batchUniverseIds, rangeLabel);
            if (!gameDetails) {
                continue;
            }

            const returnedIds = new Set(gameDetails.map(entry => String(entry.id)));
            for (const universeId of batchUniverseIds) {
                if (returnedIds.has(String(universeId))) {
                    continue;
                }

                if (deleteGame(universeId, 'missing from Roblox details API')) {
                    robloxPrunedCount++;
                }
            }
        }
    }

    const prunedGameCount = localPrunedCount + robloxPrunedCount;
    console.log(`Games pruned: ${prunedGameCount}`);
    console.log(`Embeddings pruned: ${localPruneCounts.orphanEmbeddings}`);

    if (options.dryRun) {
        console.log('Dry run complete. No files written.');
        return;
    }

    if (prunedGameCount > 0) {
        fs.writeFileSync(gamesPath, JSON.stringify(Array.from(gameMap.values()), null, 4));
        console.log(`Updated ${gamesPath}`);
    }

    if (localPruneCounts.orphanEmbeddings > 0) {
        fs.writeFileSync(embeddingsPath, JSON.stringify(embeddings, null));
        console.log(`Updated ${embeddingsPath}`);
    }

    if (prunedGameCount === 0 && localPruneCounts.orphanEmbeddings === 0) {
        console.log('No files changed.');
    }
}
