import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { openaiDescriptionModel, loadSystemPrompt } from '../tools';

export async function prepareOpenAIGameplayDescriptionBatch() {
    // read games.json
    const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
    if (!fs.existsSync(gamesPath)) {
        console.error('games.json not found. Run gatherGames first.');
        return;
    }

    const games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));

    // filter games that have a description but no gameplay description
    const gamesMissingGameplayDescriptions = games.filter(
        game =>
            game.description &&
            (!game.gameplayDescription || game.gameplayDescription.trim() === '')
    );

    if (gamesMissingGameplayDescriptions.length === 0) {
        console.log('No games are missing gameplay descriptions.');
        return;
    }

    console.log(`Preparing OpenAI batch for ${gamesMissingGameplayDescriptions.length} games...`);

    const outputDir = path.join(process.cwd(), 'data', 'games', 'openai_batches');
    fs.mkdirSync(outputDir, { recursive: true });

    const systemPrompt = await loadSystemPrompt('gameplayAnalysis');

    // Batch processing variables
    let processedCount = 0;
    let batchNumber = 1;
    const batchSize = 500;
    let currentBatchCount = 0;
    let writeStream: fs.WriteStream;

    // Initialize first batch file
    const getBatchPath = (batchNum: number) =>
        path.join(outputDir, `openai_gameplay_batch_${batchNum.toString().padStart(3, '0')}.jsonl`);

    writeStream = fs.createWriteStream(getBatchPath(batchNumber), { flags: 'w' });
    console.log(`Starting batch ${batchNumber}: ${getBatchPath(batchNumber)}`);

    for (const game of gamesMissingGameplayDescriptions) {
        // load icon and thumbnail images as base64
        const iconPath = path.join(
            process.cwd(),
            'data',
            'games',
            'images',
            game.universeId.toString(),
            'icon.webp'
        );
        const thumbnailPath = path.join(
            process.cwd(),
            'data',
            'games',
            'images',
            game.universeId.toString(),
            'thumbnail.webp'
        );
        if (!fs.existsSync(iconPath)) {
            console.warn(`Icon not found for game ${game.universeId} (${game.name}), skipping...`);
            continue;
        }
        if (!fs.existsSync(thumbnailPath)) {
            console.warn(
                `Thumbnail not found for game ${game.universeId} (${game.name}), skipping...`
            );
            continue;
        }

        // create request
        const request: {
            custom_id: string;
            method: 'POST';
            url: '/v1/chat/completions';
            body: OpenAI.ChatCompletionCreateParams;
        } = {
            custom_id: `gameplay_description_${game.universeId}`,
            method: 'POST',
            url: '/v1/chat/completions',
            body: {
                model: openaiDescriptionModel,
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `https://coolpixels.net/assets/robloxImages/${game.universeId}/icon.webp`,
                                    detail: 'low'
                                }
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `https://coolpixels.net/assets/robloxImages/${game.universeId}/thumbnail.webp`,
                                    detail: 'low'
                                }
                            },
                            {
                                type: 'text',
                                text: `**Game Title**: ${game.name}\n\n**Game Description**: ${game.description}`
                            }
                        ]
                    }
                ]
            }
        };

        // Write line to file immediately
        const line = JSON.stringify(request) + '\n';
        writeStream.write(line);
        processedCount++;
        currentBatchCount++;

        // Check if we need to start a new batch file
        if (
            currentBatchCount >= batchSize &&
            processedCount < gamesMissingGameplayDescriptions.length
        ) {
            writeStream.end();
            console.log(`Completed batch ${batchNumber}: ${currentBatchCount} games`);

            batchNumber++;
            currentBatchCount = 0;
            writeStream = fs.createWriteStream(getBatchPath(batchNumber), { flags: 'w' });
            console.log(`Starting batch ${batchNumber}: ${getBatchPath(batchNumber)}`);
        }

        // Log progress every 100 games
        if (processedCount % 100 === 0) {
            console.log(
                `Processed ${processedCount}/${gamesMissingGameplayDescriptions.length} games...`
            );
        }
    }

    // Close the write stream
    writeStream.end();
    console.log(`Completed batch ${batchNumber}: ${currentBatchCount} games`);

    console.log(
        `Prepared OpenAI batch for ${processedCount} games across ${batchNumber} batch files in ${outputDir}`
    );
}
