# Roblox Vector Search Datagen

Data gathering and processing tools for Roblox vector search. Commands collect game metadata, download assets, generate gameplay summaries, and create embeddings used by the search API and web UI.

Web UI source: https://github.com/coolpx/roblox-vector-search-webui/

Demo: https://coolpixels.net/roblox-vector-search

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

## Environment Configuration

`.env.example` is an example environment config with all values. ROBLOSECURITY is optional. It is used by `gatherGamesRolimons` for Roblox place detail lookups and descriptions. Without it, the command falls back to unauthenticated universe ID lookups which are much slower. DESCRIPTION_CONCURRENCY is also optional and sets the number of simultaneous requests to make to the model used to generate gameplay descriptions.

## Data Files

- `data/games/games.json`: canonical game list and metadata.
- `data/games/images/<universeId>/icon.png`: downloaded game icon.
- `data/games/images/<universeId>/thumbnail.png`: downloaded game thumbnail.
- `data/games/embeddings.json`: gameplay-description embeddings keyed by universe ID.

## Commands

### `gatherGames`

Collects games from Roblox Explore sorts through `apis.roblox.com/explore-api/v1/get-sorts`.

Writes and merges into `data/games/games.json`. Existing fields such as descriptions, gameplay descriptions, and player counts are preserved when possible.

### `gatherGamesRolimons`

Collects place IDs and names from `https://rolimons.com/games`.

When the environment contains `ROBLOSECURITY`, it uses a Roblox API that requires authentication to fetch universe IDs in batches. If no cookie is provided it will still work, albeit much more slowly.

### `gatherGamesFromSearch <query>`

Collects the first page of Roblox game search results from `apis.roblox.com/search-api/omni-search`.

Writes and merges into `data/games/games.json`. Search descriptions are ignored because Roblox currently returns empty descriptions for these results.

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

Uses an LLM to generate structured gameplay descriptions for games that have Roblox descriptions but lack gameplay descriptions based on their titles, descriptions, icons, and thumbnails.

Model names and prompts live in `.env` and `prompts/`.

### `generateEmbeddings`

Uses an embedding model via an OpenAI-compatible API to embed generated gameplay descriptions.

Writes `data/games/embeddings.json`.

## Build Notes

`pnpm run build` runs TypeScript compilation and regenerates Swagger docs.
