import { z } from 'zod';
import { apiResponse, apiSuccessResponse } from '../lib/apiResponseSchema';
import { jobManager } from '../lib/jobManager';
import { commands } from '../lib/commands';

const responseSchema = z.object({
    jobId: z.string(),
    message: z.string(),
    status: z.enum(['pending', 'running', 'completed', 'failed'])
});

const endpoint: ApiEndpointPost = {
    method: 'post',
    path: '/commands/gather-games',
    description: 'Start a job to gather games from Roblox API',
    operationId: 'gatherGames',
    responses: {
        200: {
            description: 'Job started successfully',
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
            // Create a new job
            const jobId = jobManager.createJob('gatherGames');

            // Start the job asynchronously
            setImmediate(async () => {
                await jobManager.runJob(jobId, async () => {
                    // Run the gatherGames command
                    await commands.gatherGames();
                    return { message: 'Games gathered successfully' };
                });
            });

            return {
                success: true,
                data: {
                    jobId,
                    message: `Job ${jobId} started for gathering games`,
                    status: 'pending' as const
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
