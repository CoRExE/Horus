// Legacy diagnostic script; retained for reference only.
const fsProv = require('../dist/providers/FrenchStream.js');

async function test() {
  const prov = new fsProv.FrenchStreamProvider();
  try {
    const streams = await prov.getStreams('15113782::movie');
    console.log("Streams found:", streams.length);
    console.log(streams);
  } catch (e) {
    console.error("Failed to get streams", e);
  }
}
test();
