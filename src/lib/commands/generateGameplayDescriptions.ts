import fs from 'fs';
import path from 'path';
import { loadSystemPrompt } from '../tools';
import { json } from 'zod';

export async function generateGameplayDescriptions() {
    const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
    if (!fs.existsSync(gamesPath)) {
        console.error('games.json not found. Run gatherGames first.');
        return;
    }

    const games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
    // summary of inclusion/exclusion breakdown
    const totalGames = games.length;
    const excludedNoDescription = games.filter(
        g => !g.description || (typeof g.description === 'string' && g.description.trim() === '')
    ).length;
    const excludedHasGameplayDesc = games.filter(
        g => g.gameplayDescription && g.gameplayDescription.trim() !== ''
    ).length;
    console.log(`Total games: ${totalGames}`);
    console.log(`Excluded (no description): ${excludedNoDescription}`);
    console.log(`Excluded (already have gameplay descriptions): ${excludedHasGameplayDesc}`);

    // Only process games that do not already have a description
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

    const systemPromptData = JSON.parse(await loadSystemPrompt('localAnalysis', 'json')) as {
        systemPrompt: string;
        schema: {};
    };

    let lastSavedGeneratedCount = 0;
    for (
        let batchStart = 0;
        batchStart < gamesMissingGameplayDescriptions.length;
        batchStart += parseInt(process.env.GAMEPLAY_DESCRIPTION_CONCURRENCY || '1')
    ) {
        const batch = gamesMissingGameplayDescriptions.slice(
            batchStart,
            batchStart + parseInt(process.env.GAMEPLAY_DESCRIPTION_CONCURRENCY || '1')
        );

        await Promise.all(
            batch.map(async (game, batchIndex) => {
                const i = batchStart + batchIndex;
                console.log(
                    `[${i + 1}/${gamesMissingGameplayDescriptions.length}] Generating gameplay description for game: ${game.name}`
                );
                try {
                    const iconPath = path.join(
                        process.cwd(),
                        'data',
                        'games',
                        'images',
                        String(game.universeId),
                        'icon.png'
                    );
                    if (!fs.existsSync(iconPath)) {
                        console.warn(
                            `[${i + 1}/${gamesMissingGameplayDescriptions.length}] Icon not found for game: ${game.name}`
                        );
                        return;
                    }
                    const iconBase64 = `data:image/png;base64,${fs.readFileSync(iconPath, 'base64')}`;

                    const thumbnailPath = path.join(
                        process.cwd(),
                        'data',
                        'games',
                        'images',
                        String(game.universeId),
                        'thumbnail.png'
                    );
                    if (!fs.existsSync(thumbnailPath)) {
                        console.warn(
                            `[${i + 1}/${gamesMissingGameplayDescriptions.length}] Thumbnail not found for game: ${game.name}`
                        );
                        return;
                    }
                    const thumbnailBase64 = `data:image/png;base64,${fs.readFileSync(thumbnailPath, 'base64')}`;

                    const response = await fetch(
                        process.env.DESCRIPTION_BASE_URL! + '/chat/completions',
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                model: process.env.DESCRIPTION_MODEL!,
                                messages: [
                                    {
                                        role: 'system',
                                        content: systemPromptData.systemPrompt
                                    },
                                    {
                                        role: 'user',
                                        content: [
                                            {
                                                type: 'text',
                                                text: `**Game Title**: ${game.name}\n\n**Game Description**: ${game.description}`
                                            },
                                            {
                                                type: 'image_url',
                                                image_url: { url: iconBase64 }
                                            },
                                            {
                                                type: 'image_url',
                                                image_url: { url: thumbnailBase64 }
                                            }
                                        ]
                                    }
                                ],
                                response_format: {
                                    type: 'json_schema',
                                    json_schema: {
                                        name: 'gameplay_description',
                                        strict: true,
                                        schema: systemPromptData.schema
                                    }
                                }
                            })
                        }
                    );
                    const responseData = JSON.parse(
                        (await response.json()).choices[0].message.content
                    ) as {
                        gameplaySummary: string;
                        genreTags: string[];
                        gameFeatures: string[];
                        confidenceScore: number;
                    };

                    const gameplayDescription =
                        `**Gameplay Summary**: ${responseData.gameplaySummary}\n\n` +
                        `**Genre Tags**: ${responseData.genreTags.join(', ')}\n\n` +
                        `**Game Features**: ${responseData.gameFeatures.join(', ')}\n\n`;

                    game.gameplayDescription = gameplayDescription;
                    console.log(
                        `[${i + 1}/${gamesMissingGameplayDescriptions.length}] Generated gameplay description for game: ${game.name}`
                    );
                } catch (error) {
                    console.error(
                        `[${i + 1}/${gamesMissingGameplayDescriptions.length}] Failed to generate gameplay description for game: ${game.name}`,
                        error
                    );
                }
            })
        );

        const generatedCount = batchStart + batch.length;
        if (generatedCount - lastSavedGeneratedCount >= 10) {
            fs.writeFileSync(gamesPath, JSON.stringify(games, null, 4));
            lastSavedGeneratedCount = generatedCount;
            console.log(
                `Saved progress after ${generatedCount} gameplay descriptions to ${gamesPath}`
            );
        }
    }
    // final save
    fs.writeFileSync(gamesPath, JSON.stringify(games, null, 4));
    console.log(
        `Updated gameplay descriptions for ${gamesMissingGameplayDescriptions.length} games in ${gamesPath}`
    );
}
