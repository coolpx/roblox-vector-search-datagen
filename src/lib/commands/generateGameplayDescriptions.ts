import fs from 'fs';
import path from 'path';
import { LMStudioClient } from '@lmstudio/sdk';
import { descriptionModel, gameplayDescriptionConcurrency, loadSystemPrompt } from '../tools';

export async function generateGameplayDescriptions() {
    const client = new LMStudioClient();

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

    const model = await client.llm.model(descriptionModel);
    const systemPromptData = JSON.parse(await loadSystemPrompt('localAnalysis', 'json')) as {
        systemPrompt: string;
        schema: {};
    };

    let lastSavedGeneratedCount = 0;
    for (
        let batchStart = 0;
        batchStart < gamesMissingGameplayDescriptions.length;
        batchStart += gameplayDescriptionConcurrency
    ) {
        const batch = gamesMissingGameplayDescriptions.slice(
            batchStart,
            batchStart + gameplayDescriptionConcurrency
        );

        await Promise.all(
            batch.map(async (game, batchIndex) => {
                const i = batchStart + batchIndex;
                console.log(
                    `[${i + 1}/${gamesMissingGameplayDescriptions.length}] Generating gameplay description for game: ${game.name}`
                );
                try {
                    const iconPath = await client.files.prepareImage(
                        path.join(
                            process.cwd(),
                            'data',
                            'games',
                            'images',
                            String(game.universeId),
                            'icon.webp'
                        )
                    );
                    const thumbnailPath = await client.files.prepareImage(
                        path.join(
                            process.cwd(),
                            'data',
                            'games',
                            'images',
                            String(game.universeId),
                            'thumbnail.webp'
                        )
                    );

                    const response = await model.respond(
                        [
                            {
                                role: 'system',
                                content: systemPromptData.systemPrompt
                            },
                            {
                                role: 'user',
                                content: `**Game Title**: ${game.name}\n\n**Game Description**: ${game.description}`,
                                images: [iconPath, thumbnailPath]
                            }
                        ],
                        {
                            structured: {
                                type: 'json',
                                jsonSchema: systemPromptData.schema
                            }
                        }
                    );

                    const responseData = JSON.parse(response.content) as {
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
