import { z } from 'zod';
import { apiResponse, apiSuccessResponse } from '../lib/apiResponseSchema';
import { jobManager } from '../lib/jobManager';
import { commands } from '../lib/commands';

const responseSchema = z.object({
    jobId: z.string(),
    message: z.string()
});

const endpoint: ApiEndpointPost = {
    method: 'post',
    path: '/generateGameplayDescriptions',
    description: 'Start a job to generate gameplay descriptions for all games using AI',
    operationId: 'generateGameplayDescriptions',
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
            const jobId = jobManager.createJob('generateGameplayDescriptions');

            // Start the job asynchronously
            setImmediate(async () => {
                await jobManager.runJob(jobId, async () => {
                    // Run the generateGameplayDescriptions command
                    await commands.generateGameplayDescriptions();
                    return { message: 'Gameplay descriptions generated successfully' };
                });
            });

            return {
                success: true,
                data: {
                    jobId,
                    message: 'Generate gameplay descriptions job started successfully'
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
