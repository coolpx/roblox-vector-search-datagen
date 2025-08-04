import { z } from 'zod';
import { Request, Response } from 'express';

type ApiResponseSchema = ReturnType<typeof import('./lib/apiResponseSchema').apiResponse>;

declare global {
    type OpenApiParameter = {
        name: string;
        in: 'query' | 'path' | 'header' | 'cookie';
        description?: string;
        required?: boolean;
        schema?: any;
    };

    type OpenApiResponse = {
        description: string;
        content: {
            [contentType: string]: {
                schema: any;
            };
        };
    };

    type ApiEndpointBase = {
        method: 'get' | 'post' | 'put' | 'delete';
        path: string;
        tag: string;
        description: string;
        handle: (req: Request, res: Response) => Promise<any>;
        operationId?: string;
        parameters?: OpenApiParameter[];
        responses: {
            [status: number]: OpenApiResponse;
        };
        response: ApiResponseSchema;
    };

    type ApiEndpointWithBody<T extends z.ZodTypeAny> = ApiEndpointBase & {
        method: 'post' | 'put';
        body?: T | undefined;
    };

    type ApiEndpointWithQuery<T extends z.ZodTypeAny> = ApiEndpointBase & {
        method: 'get' | 'delete';
        urlParams?: T | undefined;
    };

    type ApiEndpointGet = ApiEndpointWithQuery<z.ZodTypeAny>;
    type ApiEndpointPost = ApiEndpointWithBody<z.ZodTypeAny>;
    type ApiEndpointPut = ApiEndpointWithBody<z.ZodTypeAny>;
    type ApiEndpointDelete = ApiEndpointWithQuery<z.ZodTypeAny>;

    type ApiEndpoint = ApiEndpointGet | ApiEndpointPost | ApiEndpointPut | ApiEndpointDelete;

    type FilterSort = {
        contentType: 'Filters';
    };

    type Game = {
        universeId: number;
        rootPlaceId: number;
        name: string;
        description?: string | null;
        gameplayDescription?: string | null;
        playerCount?: number;
    };

    type GameSort = {
        contentType: 'Games';
        games: Game[];
    };
}
