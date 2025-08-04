import fs from 'fs';
import path from 'path';
import { z } from 'zod';

// Utility to generate example from Zod schema
/* function exampleFromZod(schema: any): any {
    if (schema instanceof z.ZodObject) {
        const shape = schema.shape;
        const result: any = {};
        for (const key in shape) {
            result[key] = exampleFromZod(shape[key]);
        }
        return result;
    }
    if (schema instanceof z.ZodArray) {
        return [exampleFromZod(schema.element)];
    }
    if (schema instanceof z.ZodString) return 'string';
    if (schema instanceof z.ZodNumber) return 0;
    if (schema instanceof z.ZodBoolean) return true;
    if (schema instanceof z.ZodLiteral) return schema.value;
    if (schema instanceof z.ZodNullable) return null;
    if (schema instanceof z.ZodUnion) return exampleFromZod(schema._def.options[0]);
    return null;
} */
function exampleFromJsonSchema(schema: any): any {
    if (schema.type === 'object') {
        const result: any = {};
        for (const key in schema.properties) {
            result[key] = exampleFromJsonSchema(schema.properties[key]);
        }
        return result;
    }
    if (schema.type === 'array') {
        return [exampleFromJsonSchema(schema.items)];
    }
    if (schema.type === 'string') return 'string';
    if (schema.type === 'number') return 0;
    if (schema.type === 'boolean') return true;
    if (schema.type === 'null') return null;
    return null;
}

// Load base swagger.json
const swagger: { openapi: string; paths: Record<string, any> } = { openapi: '3.0.0', paths: {} };

// Define global error response
const globalErrorResponse = {
    description: 'Global error response',
    content: {
        'application/json': {
            example: { success: false, message: 'Error message' },
            schema: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', data: false },
                    message: { type: 'string' }
                },
                required: ['success', 'message']
            }
        }
    }
};

// Scan built endpoints directory for .js files
const endpointsDir = path.join(process.cwd(), 'dist', 'endpoints');
const files = fs.readdirSync(endpointsDir).filter(f => f.endsWith('.js'));

// Clear existing paths to avoid duplicates
swagger.paths = {};

files.forEach(file => {
    const routeMatch = file.match(/^(.*)\.(get|post|put|delete)\.js$/);
    if (!routeMatch) return;
    const endpointModule = require(path.join(endpointsDir, file));
    const endpoint = endpointModule.default || endpointModule;
    if (!endpoint || !endpoint.method || !endpoint.path) return;
    const method = endpoint.method;
    const responses = endpoint.responses || {};
    // Generate example from 200 response schema
    let example = undefined;
    if (responses[200]?.content?.['application/json']?.schema) {
        example = exampleFromJsonSchema(responses[200].content['application/json'].schema);
    }
    // Convert Express.js path parameters (:param) to OpenAPI format ({param})
    const swaggerPath = endpoint.path.replace(/:(\w+)/g, '{$1}');

    swagger.paths[swaggerPath] = swagger.paths[swaggerPath] || {};
    swagger.paths[swaggerPath][method] = {
        summary: endpoint.description || '',
        operationId: endpoint.operationId || undefined,
        parameters: endpoint.parameters || [],
        tags: [endpoint.tag],
        responses: {
            ...responses,
            200: {
                ...responses[200],
                content: {
                    'application/json': {
                        ...responses[200]?.content?.['application/json'],
                        example
                    }
                }
            },
            default: globalErrorResponse
        }
    };
});

fs.writeFileSync(path.join(process.cwd(), 'swagger.json'), JSON.stringify(swagger, null, 2));
console.log('Swagger docs generated to swagger.json');
