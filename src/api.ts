import express from 'express';
import path from 'path';
import fs from 'fs';
import swaggerUi from 'swagger-ui-express';
import swaggerDocument from '../swagger.json';

const app = express();
const endpointsDir = path.join(process.cwd(), 'dist', 'endpoints');

const allowedMethods = ['get', 'post', 'put', 'delete'] as const;
type HttpMethod = (typeof allowedMethods)[number];

fs.readdirSync(endpointsDir).forEach(file => {
    if (file.endsWith('.js')) {
        const endpointPath = path.join(endpointsDir, file);
        const route =
            '/' + file.replace(/\.(get|post|put|delete)\.js$/, '').replace(/\.[jt]s$/, '');
        const methodMatch = file.match(/\.(get|post|put|delete)\.js$/);
        const method = methodMatch ? (methodMatch[1] as HttpMethod) : 'get';
        const handlerModule = require(endpointPath);
        const endpoint = handlerModule.default || handlerModule;
        if (allowedMethods.includes(method) && endpoint && typeof endpoint.handle === 'function') {
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
                            message: 'Invalid response format',
                            errors: parseResult.error.errors
                        });
                    }
                } catch (err) {
                    res.status(500).json({
                        success: false,
                        message: err instanceof Error ? err.message : 'Unknown error'
                    });
                }
            });
        }
    }
});

// Serve Swagger UI and docs
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

const port = process.env.PORT || 3705;
app.listen(port, () => {
    console.log(`API server running on port ${port}`);
});
