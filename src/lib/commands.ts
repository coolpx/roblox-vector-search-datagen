import { gatherGames } from './commands/gatherGames';
import { gatherGamesRolimons } from './commands/gatherGamesRolimons';
import { downloadImages } from './commands/downloadImages';
import { downloadDescriptions } from './commands/downloadDescriptions';
import { pruneGames } from './commands/pruneGames';
import { countGames } from './commands/countGames';
import { findSimilarGames } from './commands/findSimilarGames';
import { search } from './commands/search';
import { clearGameplayDescriptions } from './commands/clearGameplayDescriptions';
import { generateGameplayDescriptions } from './commands/generateGameplayDescriptions';
import { generateEmbeddings } from './commands/generateEmbeddings';

export const commands = {
    gatherGames,
    gatherGamesRolimons,
    downloadImages,
    downloadDescriptions,
    pruneGames,
    countGames,
    findSimilarGames,
    search,
    clearGameplayDescriptions,
    generateGameplayDescriptions,
    generateEmbeddings,
};
