import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { apiResponse, apiSuccessResponse } from '../lib/apiResponseSchema';

const responseSchema = z.array(
    z.object({
        universeId: z.number(),
        rootPlaceId: z.number(),
        name: z.string(),
        description: z.string().nullable(),
        gameplayDescription: z.string().nullable(),
        matchType: z.enum(['title', 'description', 'gameplayDescription']),
        relevanceScore: z.number()
    })
);

const endpoint: ApiEndpointGet = {
    method: 'get',
    path: '/search',
    tag: 'Search',
    description:
        'Search games by text matching in title, description, and gameplay description with prioritized results.',
    operationId: 'searchGames',
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
            // get search query from query params
            const query = req.query?.q as string;
            if (!query || query.trim() === '') {
                return {
                    success: false,
                    message: 'Search query (q) is required'
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

            // load games data
            const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
            if (!fs.existsSync(gamesPath)) {
                return {
                    success: false,
                    message: 'Games data not found. Run gatherGames first.'
                };
            }

            const games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));

            // normalize search query for case-insensitive matching
            const normalizedQuery = query.toLowerCase().trim();

            // search results with priority scoring
            const searchResults: Array<{
                game: Game;
                matchType: 'title' | 'description' | 'gameplayDescription';
                relevanceScore: number;
            }> = [];

            for (const game of games) {
                let bestMatch: {
                    matchType: 'title' | 'description' | 'gameplayDescription';
                    relevanceScore: number;
                } | null = null;

                // 1. Title match (highest priority)
                if (game.name && game.name.toLowerCase().includes(normalizedQuery)) {
                    const isExactMatch = game.name.toLowerCase() === normalizedQuery;
                    const startsWithQuery = game.name.toLowerCase().startsWith(normalizedQuery);

                    let score = 100; // base score for title match
                    if (isExactMatch) score += 50;
                    else if (startsWithQuery) score += 25;

                    bestMatch = { matchType: 'title', relevanceScore: score };
                }

                // 2. Description match (medium priority)
                if (
                    !bestMatch &&
                    game.description &&
                    typeof game.description === 'string' &&
                    game.description.toLowerCase().includes(normalizedQuery)
                ) {
                    const descriptionWords = game.description.toLowerCase().split(/\s+/);
                    const queryWords = normalizedQuery.split(/\s+/);

                    // Calculate word-based relevance
                    let wordMatches = 0;
                    for (const queryWord of queryWords) {
                        if (descriptionWords.some(word => word.includes(queryWord))) {
                            wordMatches++;
                        }
                    }

                    const score = 50 + (wordMatches / queryWords.length) * 20; // 50-70 range
                    bestMatch = { matchType: 'description', relevanceScore: score };
                }

                // 3. Gameplay description match (lowest priority)
                if (
                    !bestMatch &&
                    game.gameplayDescription &&
                    game.gameplayDescription.toLowerCase().includes(normalizedQuery)
                ) {
                    const gameplayWords = game.gameplayDescription.toLowerCase().split(/\s+/);
                    const queryWords = normalizedQuery.split(/\s+/);

                    // Calculate word-based relevance
                    let wordMatches = 0;
                    for (const queryWord of queryWords) {
                        if (gameplayWords.some(word => word.includes(queryWord))) {
                            wordMatches++;
                        }
                    }

                    const score = 25 + (wordMatches / queryWords.length) * 15; // 25-40 range
                    bestMatch = { matchType: 'gameplayDescription', relevanceScore: score };
                }

                if (bestMatch) {
                    searchResults.push({
                        game,
                        matchType: bestMatch.matchType,
                        relevanceScore: bestMatch.relevanceScore
                    });
                }
            }

            // sort by relevance score (highest first)
            searchResults.sort((a, b) => b.relevanceScore - a.relevanceScore);

            // limit results and format response
            const limitedResults = searchResults.slice(0, limit);
            const result = limitedResults.map(item => ({
                universeId: item.game.universeId,
                rootPlaceId: item.game.rootPlaceId,
                name: item.game.name,
                description: item.game.description ?? null,
                gameplayDescription: item.game.gameplayDescription ?? null,
                matchType: item.matchType,
                relevanceScore: Math.round(item.relevanceScore * 100) / 100 // round to 2 decimal places
            }));

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
