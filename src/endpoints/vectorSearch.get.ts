import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { apiResponse, apiSuccessResponse } from '../lib/apiResponseSchema';
import { cosineSimilarity, embeddingModel } from '../lib/tools';
import { LMStudioClient } from '@lmstudio/sdk';

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
    path: '/vector-search',
    tag: 'Search',
    description: 'Find games similar by semantic search.',
    operationId: 'vectorSearchGames',
    parameters: [
        {
            name: 'q',
            in: 'query',
            description: 'Search query text',
            required: true,
            schema: { type: 'string', minLength: 1 }
        },
        {
            name: 'limit',
            in: 'query',
            description: 'Maximum number of games to return (default: 10)',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 100 }
        }
    ],
    responses: {
        200: {
            description:
                'A list of games matching the search query, prioritized by match type (title > description > gameplay description)',
            content: {
                'application/json': {
                    schema: z.toJSONSchema(apiSuccessResponse(responseSchema))
                }
            }
        },
        400: {
            description: 'Invalid search query',
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
    urlParams: z
        .object({
            q: z.string().optional(),
            limit: z.string().optional()
        })
        .optional(),
    handle: async (req, res) => {
        try {
            // get search query and limit from query params
            const query = req.query.q;
            if (typeof query !== 'string' || query.trim().length === 0) {
                return {
                    success: false,
                    message: 'Invalid search query'
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

            // embed query
            const client = new LMStudioClient();

            const model = await client.embedding.model(embeddingModel);
            const queryEmbedding = (await model.embed(query)).embedding;

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

            // calculate similarity scores for all other games
            const similarGames: { universeId: number; similarity: number }[] = [];
            for (const [id, embedding] of Object.entries(embeddings)) {
                const gameId = parseInt(id);

                const similarity = cosineSimilarity(queryEmbedding, embedding);
                const popularityAdjustmentFactor =
                    Math.min(0.2, (gameMap.get(parseInt(id))!.playerCount || 0) / 500) + 0.8;
                similarGames.push({
                    universeId: gameId,
                    similarity: similarity * popularityAdjustmentFactor
                });
            }

            // sort by similarity (highest first) and limit results
            similarGames.sort((a, b) => b.similarity - a.similarity);
            const topSimilarGames = similarGames.slice(0, limit);

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
