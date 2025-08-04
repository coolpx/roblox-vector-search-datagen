import { z } from 'zod';
import { apiResponse, apiSuccessResponse } from '../lib/apiResponseSchema';
import { jobManager } from '../lib/jobManager';

const jobSchema = z.object({
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

const responseSchema = z.object({
    jobs: z.array(jobSchema),
    stats: z.object({
        pending: z.number(),
        running: z.number(),
        completed: z.number(),
        failed: z.number(),
        total: z.number()
    })
});

const endpoint: ApiEndpointGet = {
    method: 'get',
    path: '/jobs',
    description: 'Get all jobs and their status with statistics',
    operationId: 'getAllJobs',
    parameters: [
        {
            name: 'limit',
            in: 'query',
            description: 'Maximum number of jobs to return',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 1000, default: 100 }
        },
        {
            name: 'offset',
            in: 'query',
            description: 'Number of jobs to skip',
            required: false,
            schema: { type: 'integer', minimum: 0, default: 0 }
        },
        {
            name: 'status',
            in: 'query',
            description: 'Filter jobs by status',
            required: false,
            schema: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'] }
        },
        {
            name: 'command',
            in: 'query',
            description: 'Filter jobs by command',
            required: false,
            schema: { type: 'string' }
        }
    ],
    responses: {
        200: {
            description: 'List of jobs with statistics',
            content: {
                'application/json': {
                    schema: z.toJSONSchema(apiSuccessResponse(responseSchema))
                }
            }
        }
    },
    response: apiResponse(responseSchema),
    urlParams: z
        .object({
            limit: z.string().optional(),
            offset: z.string().optional(),
            status: z.string().optional(),
            command: z.string().optional()
        })
        .optional(),
    handle: async (req, res) => {
        try {
            // Parse query parameters
            let limit = 100;
            let offset = 0;

            if (req.query && typeof req.query.limit === 'string') {
                const parsed = parseInt(req.query.limit, 10);
                if (!isNaN(parsed) && parsed > 0 && parsed <= 1000) {
                    limit = parsed;
                }
            }

            if (req.query && typeof req.query.offset === 'string') {
                const parsed = parseInt(req.query.offset, 10);
                if (!isNaN(parsed) && parsed >= 0) {
                    offset = parsed;
                }
            }

            const status = req.query?.status as string;
            const command = req.query?.command as string;

            // Get jobs based on filters
            let jobs;
            if (status && ['pending', 'running', 'completed', 'failed'].includes(status)) {
                jobs = jobManager.getJobsByStatus(status as any);
            } else if (command) {
                jobs = jobManager.getJobsByCommand(command);
            } else {
                jobs = jobManager.getAllJobs(limit, offset);
            }

            // Get statistics
            const stats = jobManager.getJobStats();

            return {
                success: true,
                data: {
                    jobs: jobs.map(job => ({
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
                        error: job.error || undefined,
                        created_at: job.created_at.toISOString(),
                        started_at: job.started_at?.toISOString(),
                        completed_at: job.completed_at?.toISOString()
                    })),
                    stats
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
