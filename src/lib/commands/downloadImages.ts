import fs from 'fs';
import path from 'path';

export async function downloadImages() {
    // Download icon and primary thumbnail for each game
    console.log('Checking for missing images');
    const gamesPath = path.join(process.cwd(), 'data', 'games', 'games.json');
    if (!fs.existsSync(gamesPath)) {
        console.error('games.json not found. Run gatherGames first.');
        return;
    }
    const games: Game[] = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
    const wait = (ms: number) => new Promise(res => setTimeout(res, ms));
    const batchSize = 50;
    const downloadImageWithRetry = async (
        imageUrl: string,
        outputPath: string,
        rangeLabel: string,
        imageType: string,
        universeId: number
    ) => {
        let imgRes: Awaited<ReturnType<typeof fetch>> | undefined;
        let retryImg = false;
        do {
            retryImg = false;
            try {
                imgRes = await fetch(imageUrl);
                if (imgRes.status === 429) {
                    console.warn(
                        `${rangeLabel} ${imageType} image rate limited (429). Waiting 30 seconds before retrying...`
                    );
                    await wait(30000);
                    retryImg = true;
                }
            } catch (e) {
                console.error(`${rangeLabel} Failed to fetch ${imageType} for ${universeId}:`, e);
                return;
            }
        } while (retryImg);

        if (imgRes && imgRes.ok) {
            const buffer = Buffer.from(await imgRes.arrayBuffer());
            await fs.promises.writeFile(outputPath, buffer);
            console.log(`${rangeLabel} Downloaded ${imageType} for ${universeId}`);
        }
    };
    // ICONS: Only batch games that do not already have icon.png
    const gamesMissingIcon = games.filter(game => {
        const imageDir = path.join(
            process.cwd(),
            'data',
            'games',
            'images',
            String(game.universeId)
        );
        const iconPath = path.join(imageDir, 'icon.png');
        return !fs.existsSync(iconPath);
    });
    console.log(`Found ${gamesMissingIcon.length} games missing icons`);
    for (let i = 0; i < gamesMissingIcon.length; i += batchSize) {
        const batch = gamesMissingIcon.slice(i, i + batchSize);
        const batchUniverseIds = batch.map(g => g.universeId);
        const batchMap = new Map(batch.map(g => [g.universeId, g]));
        let retry = false;
        let iconRes;
        do {
            retry = false;
            const url = new URL('https://thumbnails.roblox.com/v1/games/icons');
            url.searchParams.set('universeIds', batchUniverseIds.join(','));
            url.searchParams.set('size', '512x512');
            url.searchParams.set('format', 'Png');
            url.searchParams.set('isCircular', 'false');
            try {
                iconRes = await fetch(url.toString());
                if (iconRes.status === 429) {
                    console.warn(
                        `[${i + 1}-${i + batch.length}/${gamesMissingIcon.length}] Icon API rate limited (429). Waiting 30 seconds before retrying...`
                    );
                    await wait(30000);
                    retry = true;
                }
            } catch (e) {
                console.error(
                    `[${i + 1}-${i + batch.length}/${gamesMissingIcon.length}] Failed to fetch icon batch:`,
                    e
                );
                break;
            }
        } while (retry);
        if (iconRes && iconRes.ok) {
            const iconData = await iconRes.json();
            const rangeLabel = `[${i + 1}-${i + batch.length}/${gamesMissingIcon.length}]`;
            await Promise.all(
                iconData.data.map(
                    async (entry: { targetId: number; imageUrl?: string; state?: string }) => {
                        const universeId = entry.targetId;
                        const game = batchMap.get(universeId);
                        if (!game) return;
                        const imageDir = path.join(
                            process.cwd(),
                            'data',
                            'games',
                            'images',
                            String(universeId)
                        );
                        fs.mkdirSync(imageDir, { recursive: true });
                        const iconPath = path.join(imageDir, 'icon.png');
                        if (fs.existsSync(iconPath)) {
                            console.log(
                                `[${i + 1}-${i + batch.length}/${gamesMissingIcon.length}] Icon already exists for ${universeId}`
                            );
                            return;
                        }
                        if (entry.imageUrl && entry.state === 'Completed') {
                            await downloadImageWithRetry(
                                entry.imageUrl,
                                iconPath,
                                rangeLabel,
                                'icon',
                                universeId
                            );
                        } else {
                            console.warn(
                                `[${i + 1}-${i + batch.length}/${gamesMissingIcon.length}] No valid icon for ${universeId}`
                            );
                        }
                    }
                )
            );
        }
    }
    // THUMBNAILS: Only batch games that do not already have thumbnail.png
    const gamesMissingThumb = games.filter(game => {
        const imageDir = path.join(
            process.cwd(),
            'data',
            'games',
            'images',
            String(game.universeId)
        );
        const thumbPath = path.join(imageDir, 'thumbnail.png');
        return !fs.existsSync(thumbPath);
    });
    console.log(`Found ${gamesMissingThumb.length} games missing thumbnails`);
    for (let i = 0; i < gamesMissingThumb.length; i += batchSize) {
        const batch = gamesMissingThumb.slice(i, i + batchSize);
        const batchUniverseIds = batch.map(g => g.universeId);
        const batchMap = new Map(batch.map(g => [g.universeId, g]));
        let retry = false;
        let thumbRes;
        do {
            retry = false;
            const url = new URL('https://thumbnails.roblox.com/v1/games/multiget/thumbnails');
            url.searchParams.set('universeIds', batchUniverseIds.join(','));
            url.searchParams.set('size', '768x432');
            url.searchParams.set('format', 'Png');
            url.searchParams.set('isCircular', 'false');
            try {
                thumbRes = await fetch(url.toString());
                if (thumbRes.status === 429) {
                    console.warn(
                        `[${i + 1}-${i + batch.length}/${gamesMissingThumb.length}] Thumbnail API rate limited (429). Waiting 30 seconds before retrying...`
                    );
                    await wait(30000);
                    retry = true;
                }
            } catch (e) {
                console.error(
                    `[${i + 1}-${i + batch.length}/${gamesMissingThumb.length}] Failed to fetch thumbnail batch:`,
                    e
                );
                break;
            }
        } while (retry);
        if (thumbRes && thumbRes.ok) {
            const thumbData = await thumbRes.json();
            const rangeLabel = `[${i + 1}-${i + batch.length}/${gamesMissingThumb.length}]`;
            await Promise.all(
                thumbData.data.map(
                    async (entry: {
                        universeId: number;
                        thumbnails?: { imageUrl?: string; state?: string }[];
                    }) => {
                        const universeId = entry.universeId;
                        const game = batchMap.get(universeId);
                        if (!game) return;
                        const imageDir = path.join(
                            process.cwd(),
                            'data',
                            'games',
                            'images',
                            String(universeId)
                        );
                        fs.mkdirSync(imageDir, { recursive: true });
                        const thumbPath = path.join(imageDir, 'thumbnail.png');
                        if (fs.existsSync(thumbPath)) {
                            console.log(
                                `[${i + 1}-${i + batch.length}/${gamesMissingThumb.length}] Thumbnail already exists for ${universeId}`
                            );
                            return;
                        }
                        const thumb = entry.thumbnails?.[0];
                        if (thumb && thumb.imageUrl && thumb.state === 'Completed') {
                            await downloadImageWithRetry(
                                thumb.imageUrl,
                                thumbPath,
                                rangeLabel,
                                'thumbnail',
                                universeId
                            );
                        } else {
                            console.warn(
                                `[${i + 1}-${i + batch.length}/${gamesMissingThumb.length}] No valid thumbnail for ${universeId}`
                            );
                        }
                    }
                )
            );
        }
    }
}
