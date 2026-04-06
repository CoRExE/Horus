import { AllAnimeProvider } from './src/providers/AllAnime';

async function run() {
  const provider = new AllAnimeProvider();
  
  console.log("=== Searching for 'Bleach' ===");
  const results = await provider.search("Bleach");
  console.log(results.slice(0, 3)); // Afficher les 3 premiers

  if (results.length > 0) {
    const firstResult = results[0];
    console.log(`\n=== Getting Episodes for ${firstResult.title} (ID: ${firstResult.id}) ===`);
    const episodes = await provider.getEpisodes(firstResult.id);
    console.log(`Found ${episodes.length} episodes.`);
    if (episodes.length > 0) {
      console.log("First Episode:", episodes[0]);
      
      console.log(`\n=== Getting Streams for ${episodes[0].title} ===`);
      const streams = await provider.getStreams(episodes[0].id);
      console.log(streams);
    }
  }
}

run().catch(console.error);
