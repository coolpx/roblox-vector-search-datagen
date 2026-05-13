import { wait } from '../tools';

export type RobloxPlaceDetail = {
    placeId: number;
    universeId: number;
    name?: string;
    description?: string;
};

type RobloxGameDetail = {
    id: number;
    description?: string;
    playing?: number;
};

export async function fetchRobloxGameDetailsBatch(
    universeIds: number[],
    rangeLabel: string
): Promise<RobloxGameDetail[] | undefined> {
    let retry = false;
    let descRes;
    do {
        retry = false;
        const url = new URL('https://games.roblox.com/v1/games');
        url.searchParams.set('universeIds', universeIds.join(','));
        try {
            descRes = await fetch(url.toString());
            if (descRes.status === 429) {
                console.warn(
                    `${rangeLabel} Description API rate limited (429). Waiting 30 seconds before retrying...`
                );
                await wait(30000);
                retry = true;
            }
        } catch (e) {
            console.error(`${rangeLabel} Failed to fetch description batch:`, e);
            return undefined;
        }
    } while (retry);

    if (!descRes) {
        console.warn(`${rangeLabel} No response for description batch.`);
        return undefined;
    }

    if (!descRes.ok) {
        const responseBody = await descRes.text();
        console.warn(
            `${rangeLabel} Failed to fetch description batch: ${descRes.status} ${descRes.statusText} ${responseBody}`
        );
        return undefined;
    }

    const descData = (await descRes.json()) as { data?: RobloxGameDetail[] };
    if (!Array.isArray(descData.data)) {
        console.warn(`${rangeLabel} Description batch response missing data array.`);
        return undefined;
    }

    return descData.data;
}
