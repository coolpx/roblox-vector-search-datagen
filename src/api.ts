import express from 'express';
import path from 'path';
import fs from 'fs';
import swaggerUi from 'swagger-ui-express';
import swaggerDocument from '../swagger.json';

const app = express();

// Add middleware for parsing JSON bodies
app.use(express.json());

const endpointsDir = path.join(process.cwd(), 'dist', 'endpoints');

const allowedMethods = ['get', 'post', 'put', 'delete'] as const;
type HttpMethod = (typeof allowedMethods)[number];

fs.readdirSync(endpointsDir).forEach(file => {
    if (file.endsWith('.js')) {
        const endpointPath = path.join(endpointsDir, file);
        const handlerModule = require(endpointPath);
        const endpoint = handlerModule.default || handlerModule;

        if (endpoint && typeof endpoint.handle === 'function' && endpoint.method && endpoint.path) {
            const method = endpoint.method.toLowerCase() as HttpMethod;
            const route = endpoint.path;

            if (allowedMethods.includes(method)) {
                console.log(`Registering ${method.toUpperCase()} ${route} (from ${file})`);
                app[method](route, async (req, res) => {
                    try {
                        const result = await endpoint.handle(req, res);
                        const parseResult = endpoint.response.safeParse(result);
                        if (parseResult.success) {
                            res.json(parseResult.data);
                        } else {
                            console.error('Invalid response format:', parseResult.error);
                            res.status(500).json({
                                success: false,
                                message: 'Invalid response format'
                            });
                        }
                    } catch (err) {
                        res.status(500).json({
                            success: false,
                            message: err instanceof Error ? err.message : 'Unknown error'
                        });
                    }
                });
            } else {
                console.warn(`Skipping endpoint ${file}: unsupported method ${method}`);
            }
        } else {
            console.warn(`Skipping endpoint ${file}: missing required properties`);
        }
    }
});

// Serve Swagger UI and docs
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

const port = process.env.PORT || 3705;
app.listen(port, () => {
    console.log(`API server running on port ${port}`);
});
