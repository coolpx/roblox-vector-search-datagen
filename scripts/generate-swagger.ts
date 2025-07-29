import fs from 'fs';
import path from 'path';

// Load base swagger.json
const swaggerPath = path.join(process.cwd(), 'swagger.json');
const swagger = JSON.parse(fs.readFileSync(swaggerPath, 'utf-8'));

// Scan built endpoints directory for .js files
const endpointsDir = path.join(process.cwd(), 'dist', 'endpoints');
const files = fs.readdirSync(endpointsDir).filter(f => f.endsWith('.js'));

swagger.paths = swagger.paths || {};

files.forEach(file => {
    const routeMatch = file.match(/^(.*)\.(get|post|put|delete)\.js$/);
    if (!routeMatch) return;
    const route = '/' + routeMatch[1];
    const endpointModule = require(path.join(endpointsDir, file));
    const endpoint = endpointModule.default || endpointModule;
    if (!endpoint || !endpoint.method || !endpoint.path) return;
    const method = endpoint.method;
    swagger.paths[endpoint.path] = swagger.paths[endpoint.path] || {};
    swagger.paths[endpoint.path][method] = {
        summary: endpoint.description || '',
        operationId: endpoint.operationId || undefined,
        parameters: endpoint.parameters || [],
        responses: endpoint.responses || {}
    };
});

fs.writeFileSync(swaggerPath, JSON.stringify(swagger, null, 2));
console.log('Swagger docs generated to swagger.json');
