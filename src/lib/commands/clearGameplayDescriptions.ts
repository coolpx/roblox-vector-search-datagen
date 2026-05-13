import fs from 'fs';
import path from 'path';

export async function clearGameplayDescriptions() {
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
}
