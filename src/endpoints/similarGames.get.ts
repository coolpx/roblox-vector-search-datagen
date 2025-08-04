import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { apiResponse, apiSuccessResponse } from '../lib/apiResponseSchema';
import { cosineSimilarity } from '../lib/tools';

const responseSchema = z.array(
    z.object({
        universeId: z.number(),
        rootPlaceId: z.number(),
        name: z.string(),
        description: z.string().nullable(),
        gameplayDescription: z.string().nullable(),
        similarity: z.number()
    })
);

const endpoint: ApiEndpointGet = {
    method: 'get',
    path: '/vector-search/:universeId',
    description: 'Find games similar to a given game based on embedding similarity.',
    operationId: 'getSimilarGames',
    parameters: [
        {
            name: 'universeId',
            in: 'path',
            description: 'Universe ID of the game to find similar games for',
            required: true,
            schema: { type: 'integer' }
        },
        {
            name: 'limit',
            in: 'query',
            description: 'Maximum number of similar games to return (default: 10)',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 100 }
        }
    ],
    responses: {
        200: {
            description: 'A list of similar games sorted by similarity score (highest first)',
            content: {
                'application/json': {
                    schema: z.toJSONSchema(apiSuccessResponse(responseSchema))
                }
            }
        },
        404: {
            description: 'Game not found or no embeddings available',
            content: {
                'application/json': {
                    schema: z.toJSONSchema(
                        z.object({
                            success: z.literal(false),
                            message: z.string()
                        })
                    )
                }
            }
        }
    },
    response: apiResponse(responseSchema),
    urlParams: z.object({
        universeId: z.string()
    }),
    handle: async (req, res) => {
        try {
            // get universe ID from path params
            const universeId = parseInt(req.params.universeId, 10);
            if (isNaN(universeId)) {
                return {
                    success: false,
                    message: 'Invalid universe ID'
                };
            }

            // get limit from query params
            let limit = 10; // default limit
            if (req.query && typeof req.query.limit === 'string') {
                const parsed = parseInt(req.query.limit, 10);
                if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
                    limit = parsed;
                }
            }

            // load embeddings
            const embeddingsPath = path.join(process.cwd(), 'data', 'games', 'embeddings.json');
            if (!fs.existsSync(embeddingsPath)) {
                return {
                    success: false,
                    message: 'Embeddings not found. Run generateEmbeddings first.'
                };
            }

            const embeddings: Record<number, number[]> = JSON.parse(
                fs.readFileSync(embeddingsPath, 'utf-8')
            );

            // check if target game has embeddings
            if (!(universeId in embeddings)) {
                return {
                    success: false,
                    message: `No embeddings found for game with universeId ${universeId}`
                };
            }

            const targetEmbedding = embeddings[universeId];

            // calculate similarity scores for all other games
            const similarGames: { universeId: number; similarity: number }[] = [];
            for (const [id, embedding] of Object.entries(embeddings)) {
                const gameId = parseInt(id);
                if (gameId === universeId) continue; // skip the target game itself

                const similarity = cosineSimilarity(targetEmbedding, embedding);
                similarGames.push({ universeId: gameId, similarity });
            }

            // sort by similarity (highest first) and limit results
            similarGames.sort((a, b) => b.similarity - a.similarity);
            const topSimilarGames = similarGames.slice(0, limit);

            // load games data
            const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
            if (!fs.existsSync(gamesPath)) {
                return {
                    success: false,
                    message: 'Games data not found. Run gatherGames first.'
                };
            }

            const games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
            const gameMap = new Map(games.map(g => [g.universeId, g]));

            // build response with game details
            const result = topSimilarGames
                .map(similarGame => {
                    const game = gameMap.get(similarGame.universeId);
                    if (!game) return null;

                    return {
                        universeId: game.universeId,
                        rootPlaceId: game.rootPlaceId,
                        name: game.name,
                        description: game.description ?? null,
                        gameplayDescription: game.gameplayDescription ?? null,
                        similarity: similarGame.similarity
                    };
                })
                .filter(game => game !== null);

            return {
                success: true,
                data: result
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
