# Roblox Vector Search Datagen

Data gathering and processing tools for Roblox vector search. Commands collect game metadata, download assets, generate gameplay summaries, and create embeddings used by the search API and web UI.

Web UI source: https://github.com/coolpx/roblox-vector-search-webui/

Demo: https://roblox-vector-search.coolpixels.net/

## Setup

```sh
pnpm install
pnpm run build
```

Run commands with:

```sh
node . <command>
```

Interactive command runner:

```sh
pnpm run interactive
```

API server:

```sh
pnpm run api
```

## Data Files

- `data/games/games.json`: canonical game list and metadata.
- `data/games/images/<universeId>/icon.webp`: downloaded game icon.
- `data/games/images/<universeId>/thumbnail.webp`: downloaded game thumbnail.
- `data/games/embeddings.json`: gameplay-description embeddings keyed by universe ID.
- `data/games/openai_batches/*.jsonl`: OpenAI batch input files.
- `data/games/openai_batch_output/*.jsonl`: OpenAI batch output files to import.

## Commands

### `gatherGames`

Collects games from Roblox Explore sorts through `apis.roblox.com/explore-api/v1/get-sorts`.

Writes and merges into `data/games/games.json`. Existing fields such as descriptions, gameplay descriptions, and player counts are preserved when possible.

### `gatherGamesRolimons`

Collects place IDs and names from `https://rolimons.com/games`.

When `.env` or process env contains `ROBLOSECURITY`, it uses a Roblox API that requires authentication to fetch universe IDs in batches. If no cookie is provided it will still work, albeit much more slowly.

### `downloadImages`

Downloads icons and thumbnails for games in `data/games/games.json`.

Icons use `thumbnails.roblox.com/v1/games/icons`. Thumbnails use `thumbnails.roblox.com/v1/games/multiget/thumbnails`. Existing image files are skipped.

### `downloadDescriptions`

Fetches descriptions and player counts from `games.roblox.com/v1/games` for games missing descriptions or player counts.

Updates `description` and `playerCount` in `data/games/games.json`.

### `pruneGames`

Checks all games against `games.roblox.com/v1/games` and removes any games that are not returned by the API.

### `countGames`

Prints counts for:

- total games
- games with descriptions
- games with generated gameplay descriptions

### `findSimilarGames <universeId>`

Reads `data/games/embeddings.json`, compares target embedding against all others with cosine similarity, and prints top 10 similar games.

### `clearGameplayDescriptions`

Removes generated `gameplayDescription` fields from `data/games/games.json`.

### `generateGameplayDescriptions`

Uses local LM Studio models and downloaded images to generate structured gameplay descriptions for games that have Roblox descriptions but lack gameplay descriptions.

Model names and prompts live in `src/lib/tools.ts` and `prompts/`.

### `generateEmbeddings`

Uses local LM Studio embedding model to embed generated gameplay descriptions.

Writes `data/games/embeddings.json`.

### `prepareOpenAIGameplayDescriptionBatch`

Creates OpenAI Batch API JSONL requests for games with descriptions but no gameplay descriptions.

Writes files into `data/games/openai_batches/`.

### `importOpenAIGameplayDescriptions`

Reads OpenAI batch output JSONL files from `data/games/openai_batch_output/` and imports generated gameplay descriptions into `data/games/games.json`.

## Environment

Optional `.env` values:

```env
ROBLOSECURITY=your_cookie_value
```

`gatherGamesRolimons` uses this cookie for Roblox place detail lookups and descriptions. Without it, command falls back to unauthenticated universe ID lookups.

## Build Notes

`pnpm run build` runs TypeScript compilation and regenerates Swagger docs.
