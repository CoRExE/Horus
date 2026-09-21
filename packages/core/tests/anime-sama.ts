import assert from 'node:assert/strict';
import axios, { AxiosAdapter } from 'axios';
import { AnimeSamaProvider } from '../src/providers/AnimeSama';
import { groupStreamsByLanguage } from '../src/types';

export async function testAnimeSamaLanguages() {
  const originalAdapter = axios.defaults.adapter;
  const base = 'https://anime-sama.to/catalogue/fixture/';
  const season = `${base}saison1/`;
  const sibnet = (id: number) => `https://video.sibnet.ru/shell.php?videoid=${id}`;
  const script = '<script src="episodes.js?filever=123" defer></script>';
  const pages = new Map<string, string>([
    [base, 'panneauAnime("Saison 1", "saison1/vostfr");'],
    [`${season}vostfr/`, script],
    [`${season}vostfr/episodes.js?filever=123`, `var eps1 = ['${sibnet(10)}', '${sibnet(11)}', '${sibnet(12)}'];`],
    [`${season}vf/`, script],
    [`${season}vf/episodes.js?filever=123`, `var eps1 = ['${sibnet(20)}', '', '${sibnet(22)}'];
      var eps2 = ['https://sendvid.com/vf-1', null, 'https://sendvid.com/vf-3'];
      var eps3 = ['https://vidmoly.test/vf-1',, '${sibnet(22)}'];`],
    // A generic page (HTTP 200) does not prove that a language is available.
    [`${season}vf2/`, '<html>Indisponible</html>'],
    ['https://sendvid.com/vf-1', 'video_source = "https://cdn.test/vf-1.m3u8"'],
    ['https://sendvid.com/vf-3', 'video_source = "https://cdn.test/vf-3.m3u8"'],
    ['https://vidmoly.test/vf-1', 'file: "https://cdn.test/vf-1.m3u8?token=a,b"'],
  ]);
  for (const id of [10, 11, 12, 20, 22]) pages.set(sibnet(id), 'player.src([{src: "/v/hash/video.mp4"}]);');
  const requests: string[] = [];
  axios.defaults.adapter = (async config => {
    const url = config.url!;
    requests.push(url);
    if (!pages.has(url)) throw new Error(`Fixture unavailable: ${url}`);
    return { data: pages.get(url), status: 200, statusText: 'OK', headers: {}, config };
  }) as AxiosAdapter;
  try {
    const episodes = await new AnimeSamaProvider().getEpisodes('/catalogue/fixture/');
    assert.equal(episodes.length, 3);
    assert.equal(episodes[0].id, `Saison 1::${sibnet(10)}`, 'Preserve the legacy history key');
    assert.equal(requests.some(url => /\/vf/.test(url)), false, 'Load alternate languages only on episode selection');
    // Desktop creates a fresh provider; persisted episode context must work without an instance cache.
    const first = await new AnimeSamaProvider().getStreams(episodes[0].id, JSON.parse(JSON.stringify(episodes[0])));
    const grouped = groupStreamsByLanguage(first);
    assert.equal(grouped.VOSTFR.length, 1);
    assert.deepEqual(grouped.VF.map(stream => stream.server), ['Sibnet', 'Sendvid', 'Vidmoly']);
    assert.equal(grouped.VF[0].headers?.Referer, 'https://video.sibnet.ru/');
    assert.equal(grouped.VF[2].url, 'https://cdn.test/vf-1.m3u8?token=a,b');
    const second = await new AnimeSamaProvider().getStreams(episodes[1].id, episodes[1]);
    assert.deepEqual(second.map(stream => stream.language), ['VOSTFR'], 'Missing VF slots must not shift episode 3 to episode 2');
    const third = await new AnimeSamaProvider().getStreams(episodes[2].id, episodes[2]);
    assert.deepEqual(third.filter(stream => stream.language === 'VF').map(stream => stream.url), [
      'https://video.sibnet.ru/v/hash/22.mp4', 'https://cdn.test/vf-3.m3u8',
    ], 'Keep episode indices and deduplicate identical sources');
    const beforeLegacy = requests.length;
    const legacy = await new AnimeSamaProvider().getStreams(episodes[0].id);
    assert.equal(legacy[0].language, 'VOSTFR');
    assert.equal(requests.length - beforeLegacy, 1, 'Legacy ids still resolve without context');
    pages.delete(`${season}vf/`);
    const unavailable = await new AnimeSamaProvider().getStreams(episodes[0].id, episodes[0]);
    assert.deepEqual(unavailable.map(stream => stream.language), ['VOSTFR'], 'Unavailable alternate pages must not block the original language');
    pages.set(`${season}vf1/`, script);
    pages.set(`${season}vf1/episodes.js?filever=123`, `var eps1 = ['${sibnet(20)}'];`);
    const vf1 = await new AnimeSamaProvider().getStreams(episodes[0].id, episodes[0]);
    assert.deepEqual(vf1.map(stream => stream.language), ['VOSTFR', 'VF']);
    pages.set(base, 'panneauAnime("Saison 1", "saison1/vf1");');
    const vfEpisodes = await new AnimeSamaProvider().getEpisodes('/catalogue/fixture/');
    const vfPrimary = await new AnimeSamaProvider().getStreams(vfEpisodes[0].id, vfEpisodes[0]);
    assert.equal(vfPrimary[0].language, 'VF', 'A VF catalogue link must never be labelled VOSTFR');
    // Empty slots in the original list must also retain their episode numbers.
    pages.set(`${season}vf1/episodes.js?filever=123`, `var eps1 = ['', null, , '${sibnet(22)}'];`);
    const sparse = await new AnimeSamaProvider().getEpisodes('/catalogue/fixture/');
    assert.deepEqual(sparse.map(episode => episode.number), [4]);
  } finally {
    axios.defaults.adapter = originalAdapter;
  }
}
