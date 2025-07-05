# roblox-vector-search

This is a TypeScript project using pnpm. Source files are in `src/` and compiled output is in `dist/`.

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

## Using

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
