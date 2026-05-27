import { FrenchStreamProvider } from '../src/providers/FrenchStream';

async function test() {
  const prov = new FrenchStreamProvider();
  try {
    const results = await prov.search("Les amours d'Anaïs");
    console.log("Search results:", results);
    if (results.length > 0) {
      const streams = await prov.getStreams(results[0].id + '::movie');
      console.log("Streams:", streams.map(s => s.server));
    }
  } catch (e) {
    console.error("Error:", e);
  }
}
test();
