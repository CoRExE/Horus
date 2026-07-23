import assert from 'node:assert/strict';
import { groupStreamsByLanguage, Stream } from '../src/types';
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

const packed = "eval(function(p,a,c,k,e,d){return p}('0 1',2,2,'hello|world'.split('|'),0,{}))";
assert.equal(Unpacker.unpack(packed), 'hello world');

console.log('Core unit tests passed.');
