// modules
import { LMStudio } from "./LMStudio";

// main function
async function main() {
  console.log(await LMStudio.listLoadedModels());
  console.log('---')
    console.log(await LMStudio.listModels());
}

main();
