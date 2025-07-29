// Shared tools extracted from interactive.ts
import fs from 'fs';

export const descriptionModel = 'google/gemma-3-4b';
export const embeddingModel = 'CompendiumLabs/bge-large-en-v1.5-gguf/bge-large-en-v1.5-q8_0.gguf';
export const openaiDescriptionModel = 'gpt-4o-mini';

export async function loadSystemPrompt(name: 'gameplayAnalysis') {
    return fs.readFileSync(`./prompts/${name}.txt`, 'utf-8');
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
