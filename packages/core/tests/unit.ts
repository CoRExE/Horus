import assert from 'node:assert/strict';
import {
  formatRemoteMediaTitle,
  formatDlnaTime,
  formatPlaybackTime,
  groupStreamsByLanguage,
  inferStreamFormat,
  parseDlnaTime,
  Stream,
} from '../src/types';
import { Unpacker } from '../src/utils/Unpacker';

const streams: Stream[] = [
  { url: 'https://example.test/vf.m3u8', language: 'VF', server: 'A' },
  { url: 'https://example.test/vostfr.m3u8', language: 'VOSTFR', server: 'B' },
  { url: 'https://example.test/vf-2.m3u8', language: 'VF', server: 'C' },
];

const grouped = groupStreamsByLanguage(streams);
assert.deepEqual(Object.keys(grouped), ['VF', 'VOSTFR']);
assert.equal(grouped.VF.length, 2);
assert.equal(grouped.VOSTFR[0].server, 'B');

assert.equal(inferStreamFormat(streams[0]), 'hls');
assert.equal(
  inferStreamFormat({ url: 'https://example.test/master.m3u8?token=abc' }),
  'hls'
);
assert.equal(
  inferStreamFormat({ url: 'https://example.test/playback?id=42', format: 'hls' }),
  'hls'
);
assert.equal(
  inferStreamFormat({ url: 'https://example.test/video.mp4?token=abc' }),
  'file'
);

assert.equal(
  formatRemoteMediaTitle(
    { title: 'Dune', type: 'movie' },
    { id: 'dune::movie', number: 1, title: 'Film' }
  ),
  'Dune'
);
assert.equal(
  formatRemoteMediaTitle(
    { title: 'Loki', type: 'series' },
    { id: 'loki::4', number: 4, title: 'Saison 1 - Épisode 4' }
  ),
  'Loki - Saison 1 - Ep 4'
);
assert.equal(
  formatRemoteMediaTitle(
    { title: 'Loki - Saison 1', type: 'series' },
    { id: 'loki::4', number: 4, title: 'Épisode 4' }
  ),
  'Loki - Saison 1 - Ep 4'
);

assert.equal(parseDlnaTime('01:02:03'), 3723);
assert.equal(parseDlnaTime('NOT_IMPLEMENTED'), 0);
assert.equal(parseDlnaTime('invalid'), 0);
assert.equal(formatDlnaTime(3723.9), '01:02:03');
assert.equal(formatPlaybackTime(83), '1:23');
assert.equal(formatPlaybackTime(3723), '1:02:03');

const packed = "eval(function(p,a,c,k,e,d){return p}('0 1',2,2,'hello|world'.split('|'),0,{}))";
assert.equal(Unpacker.unpack(packed), 'hello world');

console.log('Core unit tests passed.');
