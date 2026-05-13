import fs from 'fs';
import path from 'path';

export async function countGames() {
    const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
    if (!fs.existsSync(gamesPath)) {
        console.error('games.json not found. Run gatherGames first.');
        return;
    }
    const games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
    console.log(`Total games: ${games.length}`);
    const withDescriptions = games.filter(g => g.description && g.description.trim() !== '').length;
    console.log(`Games with descriptions: ${withDescriptions}`);
    const withGameplayDescriptions = games.filter(
        g => g.gameplayDescription && g.gameplayDescription.trim() !== ''
    ).length;
    console.log(`Games with gameplay descriptions: ${withGameplayDescriptions}`);
}
