import assert from 'node:assert/strict';
import {
  formatRemoteMediaTitle,
  formatDlnaTime,
  formatPlaybackTime,
  groupStreamsByLanguage,
  inferStreamFormat,
  normalizeStreamLanguage,
  parseDlnaTime,
  sortStreamLanguages,
  sortStreamsForRemotePlayback,
  Stream,
} from '../src/types';
import { Unpacker } from '../src/utils/Unpacker';
import {
  extractFsvidHlsSource,
  isPromotionalMediaUrl,
} from '../src/utils/FsvidExtractor';

const streams: Stream[] = [
  { url: 'https://example.test/vf.m3u8', language: 'VF', server: 'A' },
  { url: 'https://example.test/vostfr.m3u8', language: 'VOSTFR', server: 'B' },
  { url: 'https://example.test/vf-2.m3u8', language: 'VF', server: 'C' },
];

const grouped = groupStreamsByLanguage(streams);
assert.deepEqual(Object.keys(grouped), ['VF', 'VOSTFR']);
assert.equal(grouped.VF.length, 2);
assert.equal(grouped.VOSTFR[0].server, 'B');
assert.equal(normalizeStreamLanguage('vff'), 'VF');
assert.equal(normalizeStreamLanguage('vf-2'), 'VF');
assert.equal(normalizeStreamLanguage('sub-fr'), 'VOSTFR');
assert.equal(normalizeStreamLanguage('english'), 'VO');
assert.deepEqual(sortStreamLanguages(['VO', 'VOSTFR', 'VF']), ['VF', 'VOSTFR', 'VO']);
assert.deepEqual(
  sortStreamsForRemotePlayback([
    { url: 'https://example.test/master.m3u8', language: 'VF', server: 'HLS' },
    { url: 'https://example.test/video.mp4', language: 'VF', server: 'MP4' },
  ]).map(stream => stream.server),
  ['MP4', 'HLS']
);

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

const fsvidKey = [214, 91, 173, 44, 122, 250, 19, 88];
const fsvidRealUrl = 'https://r1.fsvid.lol/hls2/media/master.m3u8?token=valid';
const fsvidPayload = Buffer.from(
  Array.from(fsvidRealUrl, (character, index) =>
    character.charCodeAt(0) ^ fsvidKey[index % fsvidKey.length]
  )
).toString('base64');
const fsvidFixture = `
  var _fsvHls="https://s1.fsvid.lol/troll/master.m3u8";
  videojs('vjsplayer', {sources:[{src:(function(s){
    var k=[${fsvidKey.join(',')}],b=atob(s),r="";
    for(var i=0;i<b.length;i++){r+=String.fromCharCode(b.charCodeAt(i)^k[i%8])}
    return r
  })("${fsvidPayload}"),type:"application/x-mpegURL"}]});
`;
assert.equal(extractFsvidHlsSource(fsvidFixture), fsvidRealUrl);
assert.equal(
  extractFsvidHlsSource(
    `videojs('vjsplayer',{sources:[{src:"${fsvidRealUrl}",type:"application/x-mpegURL"}]})`
  ),
  fsvidRealUrl
);
assert.equal(
  extractFsvidHlsSource(
    'videojs("vjsplayer",{sources:[{src:"https://s1.fsvid.lol/troll/master.m3u8",type:"application/x-mpegURL"}]})'
  ),
  null
);
assert.equal(isPromotionalMediaUrl('https://cdn.example/ad/master.m3u8'), true);
assert.equal(isPromotionalMediaUrl(fsvidRealUrl), false);

console.log('Core unit tests passed.');
