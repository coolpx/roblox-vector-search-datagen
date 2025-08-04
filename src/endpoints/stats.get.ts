import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { apiResponse, apiSuccessResponse } from '../lib/apiResponseSchema';

const responseSchema = z.object({
    totalGames: z.number(),
    gamesLackingIcons: z.number(),
    gamesLackingThumbnails: z.number(),
    gamesLackingDescriptions: z.number(),
    gamesLackingGameplayDescriptions: z.number(),
    gamesLackingEmbeddings: z.number()
});

const endpoint: ApiEndpointGet = {
    method: 'get',
    path: '/stats',
    tag: 'Stats',
    description: 'Get statistics about game data completeness',
    operationId: 'getStats',
    responses: {
        200: {
            description: 'Games data statistics',
            content: {
                'application/json': {
                    schema: z.toJSONSchema(apiSuccessResponse(responseSchema))
                }
            }
        }
    },
    response: apiResponse(responseSchema),
    handle: async (req, res) => {
        try {
            // Read games.json
            const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');

            if (!fs.existsSync(gamesPath)) {
                return {
                    success: false,
                    message: 'games.json not found. Run gatherGames first.'
                };
            }

            const games = JSON.parse(fs.readFileSync(gamesPath, 'utf-8')) as Game[];
            const totalGames = games.length;

            // Count games lacking icons
            const gamesLackingIcons = games.filter(game => {
                const imageDir = path.join(
                    process.cwd(),
                    'data',
                    'games',
                    'images',
                    String(game.universeId)
                );
                const iconPath = path.join(imageDir, 'icon.webp');
                return !fs.existsSync(iconPath);
            }).length;

            // Count games lacking thumbnails
            const gamesLackingThumbnails = games.filter(game => {
                const imageDir = path.join(
                    process.cwd(),
                    'data',
                    'games',
                    'images',
                    String(game.universeId)
                );
                const thumbPath = path.join(imageDir, 'thumbnail.webp');
                return !fs.existsSync(thumbPath);
            }).length;

            // Count games lacking descriptions
            const gamesLackingDescriptions = games.filter(
                game =>
                    game.description === undefined ||
                    game.description === '' ||
                    game.description === null
            ).length;

            // Count games lacking gameplay descriptions
            const gamesLackingGameplayDescriptions = games.filter(
                game => !game.gameplayDescription || game.gameplayDescription.trim() === ''
            ).length;

            // Count games lacking embeddings
            const embeddingsPath = path.join(process.cwd(), 'data', 'games', 'embeddings.json');
            let gamesLackingEmbeddings = totalGames; // Default to all games lacking embeddings

            if (fs.existsSync(embeddingsPath)) {
                try {
                    const embeddingsData = JSON.parse(fs.readFileSync(embeddingsPath, 'utf-8'));
                    // If embeddings.json exists and has data, count games without embeddings
                    if (embeddingsData && typeof embeddingsData === 'object') {
                        const gameIds = games.map(game => String(game.universeId));
                        gamesLackingEmbeddings = gameIds.filter(id => !embeddingsData[id]).length;
                    }
                } catch (err) {
                    // If embeddings.json is invalid, all games lack embeddings
                    console.warn('Failed to parse embeddings.json:', err);
                }
            }

            return {
                success: true,
                data: {
                    totalGames,
                    gamesLackingIcons,
                    gamesLackingThumbnails,
                    gamesLackingDescriptions,
                    gamesLackingGameplayDescriptions,
                    gamesLackingEmbeddings
                }
            };
        } catch (err) {
            return {
                success: false,
                message: err instanceof Error ? err.message : 'Unknown error'
            };
        }
    }
};

export default endpoint;
