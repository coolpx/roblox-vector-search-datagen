import { z } from 'zod';
import { apiResponse, apiSuccessResponse } from '../lib/apiResponseSchema';
import { jobManager } from '../lib/jobManager';

const responseSchema = z.object({
    id: z.string(),
    command: z.string(),
    status: z.enum(['pending', 'running', 'completed', 'failed']),
    progress: z
        .object({
            current: z.number(),
            total: z.number(),
            message: z.string().optional()
        })
        .optional(),
    result: z.any().optional(),
    error: z.string().nullable().optional(),
    created_at: z.string(),
    started_at: z.string().optional(),
    completed_at: z.string().optional()
});

const endpoint: ApiEndpointGet = {
    method: 'get',
    path: '/jobs/:id',
    description: 'Get details of a specific job by ID',
    operationId: 'getJob',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'Job ID',
            required: true,
            schema: { type: 'string' }
        }
    ],
    responses: {
        200: {
            description: 'Job details',
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
            const jobId = req.params?.id;
            if (!jobId) {
                return {
                    success: false,
                    message: 'Job ID is required'
                };
            }

            const job = jobManager.getJob(jobId);
            if (!job) {
                return {
                    success: false,
                    message: `Job not found: ${jobId}`
                };
            }

            return {
                success: true,
                data: {
                    id: job.id,
                    command: job.command,
                    status: job.status,
                    progress:
                        job.progress_current !== null &&
                        job.progress_current !== undefined &&
                        job.progress_total !== null &&
                        job.progress_total !== undefined
                            ? {
                                  current: job.progress_current,
                                  total: job.progress_total,
                                  message: job.progress_message || undefined
                              }
                            : undefined,
                    result: job.result,
                    error: job.error,
                    created_at: job.created_at.toISOString(),
                    started_at: job.started_at?.toISOString(),
                    completed_at: job.completed_at?.toISOString()
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
