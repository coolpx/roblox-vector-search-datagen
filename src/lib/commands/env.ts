import fs from 'fs';
import path from 'path';

function parseEnvFile(envPath: string): Record<string, string> {
    if (!fs.existsSync(envPath)) {
        return {};
    }

    const values: Record<string, string> = {};
    const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) {
            continue;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        let value = trimmed.slice(separatorIndex + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        values[key] = value;
    }

    return values;
}

export function getRoblosecurityCookie(): string | undefined {
    const envValues = parseEnvFile(path.join(process.cwd(), '.env'));
    const roblosecurity =
        envValues.ROBLOSECURITY ||
        envValues.roblosecurity ||
        envValues['.ROBLOSECURITY'] ||
        process.env.ROBLOSECURITY ||
        process.env.roblosecurity ||
        process.env['.ROBLOSECURITY'];

    if (!roblosecurity) {
        return undefined;
    }

    return roblosecurity.includes('.ROBLOSECURITY=')
        ? roblosecurity
        : `.ROBLOSECURITY=${roblosecurity}`;
}
