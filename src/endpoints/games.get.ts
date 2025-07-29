import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { apiResponse } from '../lib/apiResponseSchema';

const responseSchema = apiResponse(
    z.array(
        z.object({
            universeId: z.number(),
            rootPlaceId: z.number(),
            name: z.string(),
            description: z.string().nullable(),
            gameplayDescription: z.string().nullable()
        })
    )
);

const endpoint: ApiEndpointGet = {
    method: 'get',
    path: '/games',
    description:
        'Get the list of all games in the database. Optional query param: ?limit=<number> to limit results',
    operationId: 'getGames',
    parameters: [
        {
            name: 'limit',
            in: 'query',
            description: 'Maximum number of games to return',
            required: false,
            schema: { type: 'integer', minimum: 1 }
        }
    ],
    responses: {
        200: {
            description: 'A list of games',
            content: {
                'application/json': {
                    schema: responseSchema
                }
            }
        },
        400: {
            description: 'Invalid request',
            content: {
                'application/json': {
                    schema: z.object({ success: z.literal(false), message: z.string() })
                }
            }
        }
    },
    response: responseSchema,
    urlParams: z
        .object({
            limit: z.string().optional()
        })
        .optional(),
    handle: async (req, res) => {
        try {
            // read games.json
            const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
            const games = JSON.parse(fs.readFileSync(gamesPath, 'utf-8')) as Game[];

            // get limit from query params
            let limit: number | undefined = undefined;
            if (req.query && typeof req.query.limit === 'string') {
                const parsed = parseInt(req.query.limit, 10);
                if (!isNaN(parsed) && parsed > 0) {
                    limit = parsed;
                }
            }

            // sort and optionally limit games
            let sortedGames = games.sort((a, b) => a.name.localeCompare(b.name));
            if (limit !== undefined) {
                sortedGames = sortedGames.slice(0, limit);
            }

            return {
                success: true,
                data: sortedGames.map(game => ({
                    universeId: game.universeId,
                    rootPlaceId: game.rootPlaceId,
                    name: game.name,
                    description: game.description ?? null,
                    gameplayDescription: game.gameplayDescription ?? null
                }))
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
