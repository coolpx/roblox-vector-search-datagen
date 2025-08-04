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
    path: '/generateEmbeddings',
    description: 'Start a job to generate vector embeddings for all games',
    operationId: 'generateEmbeddings',
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
            const jobId = jobManager.createJob('generateEmbeddings');

            // Start the job asynchronously
            setImmediate(async () => {
                await jobManager.runJob(jobId, async () => {
                    // Run the generateEmbeddings command
                    await commands.generateEmbeddings();
                    return { message: 'Embeddings generated successfully' };
                });
            });

            return {
                success: true,
                data: {
                    jobId,
                    message: 'Generate embeddings job started successfully'
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
