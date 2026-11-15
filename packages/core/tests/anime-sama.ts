import assert from 'node:assert/strict';
import axios, { AxiosAdapter } from 'axios';
import { AnimeSamaProvider } from '../src/providers/AnimeSama';
import { groupStreamsByLanguage } from '../src/types';

export async function testAnimeSamaLanguages() {
  const originalAdapter = axios.defaults.adapter;
  const base = 'https://anime-sama.to/catalogue/fixture/';
  const season = `${base}saison1/`;
  const sibnet = (id: number) => `https://video.sibnet.ru/shell.php?videoid=${id}`;
  const sendvid = (id: number) => `https://sendvid.com/episode-${id}`;
  const script = '<script src="episodes.js?filever=123" defer></script>';
  const pages = new Map<string, string>([
    ['https://anime-sama.to/catalogue/', `
      <a href="/catalogue/">Catalogue</a>
      <div class="as-carte"><a href="https://anime-sama.to/catalogue/naruto/">
        <img src="/images/naruto.webp"><h3 class="as-carte-titre"> Naruto </h3>
      </a></div>
      <a href="/catalogue/legacy/"><img src="https://cdn.test/legacy.jpg"><h2 class="card-title">Legacy</h2></a>
      <a href="/catalogue/naruto/"><h3 class="as-carte-titre">Naruto</h3></a>`],
    [base, 'panneauAnime("Saison 1", "saison1/vostfr");'],
    [`${season}vostfr/`, script],
    [`${season}vostfr/episodes.js?filever=123`, `var eps1 = ['${sibnet(10)}', '${sibnet(11)}', '${sibnet(12)}'];
      var eps2 = ['${sendvid(10)}', '${sendvid(11)}', '${sendvid(12)}'];`],
    [`${season}vf/`, script],
    [`${season}vf/episodes.js?filever=123`, `var eps1 = ['${sibnet(20)}', '', '${sibnet(22)}'];
      var eps2 = ['https://sendvid.com/vf-1', null, 'https://sendvid.com/vf-3'];
      var eps3 = ['https://vidmoly.test/vf-1',, 'https://sendvid.com/vf-3'];
      var eps4 = ['https://smoothpre.test/vf-1',, ''];
      var eps5 = ['https://smoothpre.test/links-1', 'https://uqload.test/vf-2', 'https://ansembed.test/vf-3'];`],
    // A generic page (HTTP 200) does not prove that a language is available.
    [`${season}vf2/`, '<html>Indisponible</html>'],
    ['https://sendvid.com/vf-1', 'video_source = "https://cdn.test/vf-1.m3u8"'],
    ['https://sendvid.com/vf-3', 'video_source = "https://cdn.test/vf-3.m3u8"'],
    ['https://vidmoly.test/vf-1', 'file: "https://cdn.test/vf-1.m3u8?token=a,b"'],
    ['https://smoothpre.test/vf-1', `eval(function(p,a,c,k,e,d){return p}('"https://cdn.test/vf-1.txt"',2,0,''.split('|'),0,{}))`],
    // Current Smoothpre pages list mirrors; hls4 is relative to the embed host.
    ['https://smoothpre.test/links-1', `eval(function(p,a,c,k,e,d){return p}('var links={"hls3":"https://mirror.test/master.txt","hls2":"https://cdn.test/hls2.m3u8?t=1","hls4":"/stream/abc/master.m3u8"};',2,0,''.split('|'),0,{}))`],
    ['https://uqload.test/vf-2', `eval(function(p,a,c,k,e,d){return p}('jwplayer("vplayer").setup({sources:[{file:"https://cdn.test/uqload.m3u8?t=2"}]})',2,0,''.split('|'),0,{}))`],
    ['https://ansembed.test/vf-3', `<script>eval(function(p,a,c,k,e,d){return p}('isSandboxed()',2,0,''.split('|'),0,{}))</script>
      <script>jwplayer("vplayer").setup({ sources: [{ file: 'https://cdn.test/ansembed.m3u8?t=3' }] });</script>`],
  ]);
  for (const id of [10, 11, 12, 20, 22]) {
    pages.set(sendvid(id), `video_source = "https://cdn.test/episode-${id}.m3u8"`);
  }
  const requests: string[] = [];
  axios.defaults.adapter = (async config => {
    const url = config.url!;
    requests.push(url);
    if (!pages.has(url)) throw new Error(`Fixture unavailable: ${url}`);
    return { data: pages.get(url), status: 200, statusText: 'OK', headers: {}, config };
  }) as AxiosAdapter;
  try {
    const results = await new AnimeSamaProvider().search('naruto');
    assert.deepEqual(results.map(({ id, title, coverUrl }) => ({ id, title, coverUrl })), [
      { id: '/catalogue/naruto/', title: 'Naruto', coverUrl: 'https://anime-sama.to/images/naruto.webp' },
      { id: '/catalogue/legacy/', title: 'Legacy', coverUrl: 'https://cdn.test/legacy.jpg' },
    ]);
    const episodes = await new AnimeSamaProvider().getEpisodes('/catalogue/fixture/');
    assert.equal(episodes.length, 3);
    assert.equal(episodes[0].id, `Saison 1::${sibnet(10)}|||${sendvid(10)}`, 'Preserve the legacy history key, including retired sources');
    assert.equal(requests.some(url => /\/vf/.test(url)), false, 'Load alternate languages only on episode selection');
    // Desktop creates a fresh provider; persisted episode context must work without an instance cache.
    const first = await new AnimeSamaProvider().getStreams(episodes[0].id, JSON.parse(JSON.stringify(episodes[0])));
    const grouped = groupStreamsByLanguage(first);
    assert.equal(grouped.VOSTFR.length, 1);
    assert.equal(grouped.VOSTFR[0].server, 'Sendvid');
    assert.deepEqual(grouped.VF.map(stream => stream.server), ['Sendvid', 'Vidmoly', 'Smoothpre', 'Smoothpre']);
    assert.equal(grouped.VF[1].url, 'https://cdn.test/vf-1.m3u8?token=a,b');
    assert.equal(grouped.VF[2].url, 'https://cdn.test/vf-1.m3u8');
    assert.equal(grouped.VF[3].url, 'https://smoothpre.test/stream/abc/master.m3u8', 'Prefer the relative hls4 Smoothpre mirror');
    const second = await new AnimeSamaProvider().getStreams(episodes[1].id, episodes[1]);
    assert.deepEqual(second.map(stream => `${stream.language}:${stream.server}:${stream.url}`), [
      'VOSTFR:Sendvid:https://cdn.test/episode-11.m3u8',
      'VF:Uqload:https://cdn.test/uqload.m3u8?t=2',
    ], 'Missing VF slots must not shift episode 3 to episode 2');
    const third = await new AnimeSamaProvider().getStreams(episodes[2].id, episodes[2]);
    assert.deepEqual(third.filter(stream => stream.language === 'VF').map(stream => stream.url), [
      'https://cdn.test/vf-3.m3u8',
      'https://cdn.test/ansembed.m3u8?t=3',
    ], 'Keep episode indices and deduplicate identical sources');
    const beforeLegacy = requests.length;
    const legacy = await new AnimeSamaProvider().getStreams(episodes[0].id);
    assert.equal(legacy[0].language, 'VOSTFR');
    assert.equal(requests.length - beforeLegacy, 1, 'Legacy ids still resolve without context');
    const beforeRetired = requests.length;
    const retired = await new AnimeSamaProvider().getStreams(`Saison 1::${sibnet(10)}`);
    assert.deepEqual(retired, [], 'A retired-only legacy id must not offer an unusable stream');
    assert.equal(requests.length, beforeRetired, 'Do not query Sibnet for old history entries');
    pages.delete(`${season}vf/`);
    const unavailable = await new AnimeSamaProvider().getStreams(episodes[0].id, episodes[0]);
    assert.deepEqual(unavailable.map(stream => stream.language), ['VOSTFR'], 'Unavailable alternate pages must not block the original language');
    pages.set(`${season}vf1/`, script);
    pages.set(`${season}vf1/episodes.js?filever=123`, `var eps1 = ['${sendvid(20)}'];`);
    const vf1 = await new AnimeSamaProvider().getStreams(episodes[0].id, episodes[0]);
    assert.deepEqual(vf1.map(stream => stream.language), ['VOSTFR', 'VF']);
    pages.set(base, 'panneauAnime("Saison 1", "saison1/vf1");');
    const vfEpisodes = await new AnimeSamaProvider().getEpisodes('/catalogue/fixture/');
    const vfPrimary = await new AnimeSamaProvider().getStreams(vfEpisodes[0].id, vfEpisodes[0]);
    assert.equal(vfPrimary[0].language, 'VF', 'A VF catalogue link must never be labelled VOSTFR');
    // Empty slots in the original list must also retain their episode numbers.
    pages.set(`${season}vf1/episodes.js?filever=123`, `var eps1 = ['', null, , '${sendvid(22)}'];`);
    const sparse = await new AnimeSamaProvider().getEpisodes('/catalogue/fixture/');
    assert.deepEqual(sparse.map(episode => episode.number), [4]);
    assert.equal(requests.some(url => new URL(url).hostname.endsWith('sibnet.ru')), false,
      'Retired sources must never trigger HTTP requests');

    // Layout since 12/11/2026: inline lists of `lien:<n°>` references, resolved by /api/lien.php
    // with the page token. Link 2 is marked deleted, link 3 is on a host without extractor.
    const inline = 'https://anime-sama.to/catalogue/inline/';
    const lien = (token: string, id: number) => `https://anime-sama.to/api/lien.php?j=${token}&l=${id}`;
    pages.set(inline, 'panneauAnime("Saison 1", "saison1/vostfr");');
    pages.set(`${inline}saison1/vostfr/`, `<script data-source="bdd">var eps1 = ["lien:1","lien:4"];
      var eps2 = ["lien:2","lien:5"];
      var eps3 = ["lien:3",""];
      var epsMeta = {"1":["uqload.vc"],"2":["ansembed.net",1],"3":["derricknationtop.com"],"4":["vidmoly.biz"],"5":["sendvid.com"]};
      var epsJeton = "tok.vostfr";
      var epsOrdreFinal = true;</script>`);
    pages.set(`${inline}saison1/vf/`, `<script data-source="bdd">var eps1 = ["lien:7"];
      var epsMeta = {"7":["uqload.vc"]};
      var epsJeton = "tok.vf";</script>`);
    // Desktop's native transport hands JSON back as text.
    pages.set(lien('tok.vostfr', 1), '{"u":"https://uqload.test/inline-1"}');
    pages.set(lien('tok.vostfr', 4), '{"u":"https://vidmoly.test/inline-4"}');
    pages.set(lien('tok.vostfr', 5), '{"u":"https://sendvid.com/inline-5"}');
    pages.set(lien('tok.vf', 7), '{"u":"https://uqload.test/inline-7"}');
    pages.set('https://uqload.test/inline-1', 'jwplayer("v").setup({sources:[{file:"https://cdn.test/inline-1.m3u8"}]})');
    pages.set('https://uqload.test/inline-7', 'jwplayer("v").setup({sources:[{file:"https://cdn.test/inline-7.m3u8"}]})');
    pages.set('https://vidmoly.test/inline-4', 'file: "https://cdn.test/inline-4.m3u8"');
    pages.set('https://sendvid.com/inline-5', 'video_source = "https://cdn.test/inline-5.m3u8"');
    const inlineEpisodes = await new AnimeSamaProvider().getEpisodes('/catalogue/inline/');
    assert.deepEqual(inlineEpisodes.map(episode => episode.id), [
      'Saison 1::lien:1|||lien:2|||lien:3',
      'Saison 1::lien:4|||lien:5',
    ], 'Ids keep every link reference, dead ones included, so they stay stable');
    assert.equal(requests.some(url => url.includes('/api/lien.php')), false, 'Links are resolved only on playback');
    const inlineFirst = await new AnimeSamaProvider().getStreams(inlineEpisodes[0].id, inlineEpisodes[0]);
    assert.deepEqual(inlineFirst.map(stream => `${stream.language}:${stream.server}:${stream.url}`), [
      'VOSTFR:Uqload:https://cdn.test/inline-1.m3u8',
      'VF:Uqload:https://cdn.test/inline-7.m3u8',
    ]);
    assert.equal(requests.includes(lien('tok.vostfr', 2)), false, 'Deleted links are not resolved');
    assert.equal(requests.includes(lien('tok.vostfr', 3)), false, 'Links without an extractor are not resolved');
    const inlineSecond = await new AnimeSamaProvider().getStreams(inlineEpisodes[1].id, inlineEpisodes[1]);
    assert.deepEqual(inlineSecond.map(stream => stream.server), ['Vidmoly', 'Sendvid'],
      'The VF list has no second episode; the gap in eps3 keeps the numbering');
    assert.deepEqual(await new AnimeSamaProvider().getStreams(inlineEpisodes[0].id), [],
      'Without the season context there is no page token to resolve a reference');
  } finally {
    axios.defaults.adapter = originalAdapter;
  }
}
