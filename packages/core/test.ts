import { AnimeSamaProvider } from './src/providers/AnimeSama';

async function run() {
    const provider = new AnimeSamaProvider();
    
    console.log('--- TEST: SEARCH ---');
    console.log('Searching for "naruto"...');
    const results = await provider.search('naruto');
    console.log(`Found ${results.length} results.`);
    console.log(results[0]);

    if (results.length > 0) {
        console.log('\n--- TEST: EPISODES ---');
        console.log(`Getting episodes for First Result (${results[0].title})...`);
        const episodes = await provider.getEpisodes(results[0].id);
        console.log(`Found ${episodes.length} episodes.`);
        
        if (episodes.length > 0) {
             const firstEp = episodes[0];
             console.log('First Episode:', firstEp);

             console.log('\n--- TEST: STREAMS ---');
             console.log(`Resolving stream for ${firstEp.title}...`);
             const streams = await provider.getStreams(firstEp.id);
             console.log(streams);
        }
    }
}

run().catch(console.error);
