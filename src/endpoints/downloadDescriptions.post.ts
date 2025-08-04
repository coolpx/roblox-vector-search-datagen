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
    path: '/downloadDescriptions',
    description: 'Start a job to download descriptions for all games',
    operationId: 'downloadDescriptions',
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
            const jobId = jobManager.createJob('downloadDescriptions');

            // Start the job asynchronously
            setImmediate(async () => {
                await jobManager.runJob(jobId, async () => {
                    // Run the downloadDescriptions command
                    await commands.downloadDescriptions();
                    return { message: 'Descriptions downloaded successfully' };
                });
            });

            return {
                success: true,
                data: {
                    jobId,
                    message: 'Download descriptions job started successfully'
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
