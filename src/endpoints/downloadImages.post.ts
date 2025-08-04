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
    path: '/downloadImages',
    description: 'Start a job to download icons and thumbnails for all games',
    operationId: 'downloadImages',
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
            const jobId = jobManager.createJob('downloadImages');

            // Start the job asynchronously
            setImmediate(async () => {
                await jobManager.runJob(jobId, async () => {
                    // Run the downloadImages command
                    await commands.downloadImages();
                    return { message: 'Images downloaded successfully' };
                });
            });

            return {
                success: true,
                data: {
                    jobId,
                    message: 'Download images job started successfully'
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
