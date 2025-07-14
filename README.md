# Web UI source code: https://github.com/coolpx/roblox-vector-search-webui/
# Demo: https://roblox-vector-search.coolpixels.net/

# Roblox Vector Search

Tools for gathering and processing Roblox data to create embeddings which are hopefully based on gameplay.

## Setup

1. Install dependencies:

```sh
pnpm install
```

2. Build the project:

```sh
pnpm run build
```

3. Run the project:

```sh
pnpm start
```

## Usage

1. Gather games

```sh
node . gatherGames
```

2. Download images

```sh
node . downloadImages
```

3. Download descriptions

```sh
node . downloadDescriptions
```

4. Generate embeddings

```sh
node . generateEmbeddings
```

5. Find similar games

```sh
node . findSimilarGames {universeId}
```
