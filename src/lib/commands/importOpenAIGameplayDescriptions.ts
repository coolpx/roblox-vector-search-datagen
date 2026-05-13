import fs from 'fs';
import path from 'path';

export async function importOpenAIGameplayDescriptions() {
    // Import gameplay descriptions from OpenAI batch output files
    const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
    if (!fs.existsSync(gamesPath)) {
        console.error('games.json not found. Run gatherGames first.');
        return;
    }

    const games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
    const gameMap = new Map(games.map(g => [g.universeId, g]));

    const outputDir = path.join(process.cwd(), 'data', 'games', 'openai_batch_output');
    if (!fs.existsSync(outputDir)) {
        console.error('openai_batch_output directory not found.');
        return;
    }

    // Get all JSONL files in the output directory
    const outputFiles = fs.readdirSync(outputDir).filter(file => file.endsWith('.jsonl'));
    if (outputFiles.length === 0) {
        console.error('No JSONL files found in openai_batch_output directory.');
        return;
    }

    console.log(`Found ${outputFiles.length} batch output files to process...`);

    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalErrors = 0;

    for (const file of outputFiles) {
        const filePath = path.join(outputDir, file);
        console.log(`Processing file: ${file}`);

        try {
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const lines = fileContent.trim().split('\n');

            let fileProcessed = 0;
            let fileUpdated = 0;
            let fileErrors = 0;

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const batchResponse = JSON.parse(line);
                    totalProcessed++;
                    fileProcessed++;

                    // Extract universe ID from custom_id
                    const customId = batchResponse.custom_id;
                    if (!customId || !customId.startsWith('gameplay_description_')) {
                        console.warn(`Invalid custom_id format: ${customId}`);
                        totalErrors++;
                        fileErrors++;
                        continue;
                    }

                    const universeId = parseInt(customId.replace('gameplay_description_', ''));
                    const game = gameMap.get(universeId);

                    if (!game) {
                        console.warn(`Game not found for universe ID: ${universeId}`);
                        totalErrors++;
                        fileErrors++;
                        continue;
                    }

                    // Check if the response was successful
                    if (batchResponse.error) {
                        console.warn(
                            `Error in batch response for game ${universeId}: ${batchResponse.error}`
                        );
                        totalErrors++;
                        fileErrors++;
                        continue;
                    }

                    if (batchResponse.response?.status_code !== 200) {
                        console.warn(
                            `Non-200 status code for game ${universeId}: ${batchResponse.response?.status_code}`
                        );
                        totalErrors++;
                        fileErrors++;
                        continue;
                    }

                    // Extract the gameplay description from the response
                    const choices = batchResponse.response?.body?.choices;
                    if (!choices || choices.length === 0) {
                        console.warn(`No choices in response for game ${universeId}`);
                        totalErrors++;
                        fileErrors++;
                        continue;
                    }

                    const gameplayDescription = choices[0]?.message?.content;
                    if (!gameplayDescription) {
                        console.warn(`No content in response for game ${universeId}`);
                        totalErrors++;
                        fileErrors++;
                        continue;
                    }

                    // Update the game with the gameplay description
                    game.gameplayDescription = gameplayDescription.trim();
                    totalUpdated++;
                    fileUpdated++;

                    console.log(
                        `Updated gameplay description for game ${universeId} (${game.name})`
                    );
                } catch (error) {
                    console.error(`Error parsing line in file ${file}:`, error);
                    totalErrors++;
                    fileErrors++;
                }
            }

            console.log(
                `File ${file}: Processed ${fileProcessed}, Updated ${fileUpdated}, Errors ${fileErrors}`
            );
        } catch (error) {
            console.error(`Error reading file ${file}:`, error);
        }
    }

    // Save the updated games
    fs.writeFileSync(gamesPath, JSON.stringify(games, null, 4));

    console.log(`\nImport completed:`);
    console.log(`Total responses processed: ${totalProcessed}`);
    console.log(`Games updated: ${totalUpdated}`);
    console.log(`Errors: ${totalErrors}`);
    console.log(`Updated games saved to: ${gamesPath}`);
}
