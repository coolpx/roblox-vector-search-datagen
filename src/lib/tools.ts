// Shared tools extracted from interactive.ts
import fs from 'fs';

export const descriptionModel = 'google/gemma-4-e2b';
export const embeddingModel = 'unsloth/embeddinggemma-300m-GGUF';
export const gameplayDescriptionConcurrency = 2;

export async function loadSystemPrompt(
    name: 'gameplayAnalysis' | 'localAnalysis',
    fileExtension: 'json' | 'txt' = 'txt'
) {
    return fs.readFileSync(`./prompts/${name}.${fileExtension}`, 'utf-8');
}

export function wait(ms: number) {
    return new Promise(res => setTimeout(res, ms));
}

export function cosineSimilarity(a: number[], b: number[]) {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (normA * normB);
}
