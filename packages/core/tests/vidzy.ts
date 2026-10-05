import assert from 'node:assert/strict';
import axios, { AxiosAdapter, AxiosError } from 'axios';
import { extractVidzySeriesSeason, isVidzyEpisodeForMedia, VidzyProvider } from '../src/providers/Vidzy';

const origin = 'https://vidzy.org';
const wrapper = (id: string, season: number, episodes: number[], title: string, language = 'vf') =>
  `<title>${title}</title><iframe src="https://vidzy.cc/embed-${id}-${season}-${language}.html"></iframe>` +
  `<script>var CFG=${JSON.stringify({ type: 'tv', season, episodes, baseSerie: `${origin}/serie/${id}/${season}` })};</script>`;
const film = (id: string, title: string, language = 'vf') =>
  `<title>${title}</title><iframe src="https://vidzy.cc/embed-film-${id}-${language}.html"></iframe>` +
  '<script>var CFG={"type":"movie","episodes":[]};</script>';

export async function testVidzyMediaTypes() {
  const originalAdapter = axios.defaults.adapter;
  const pages = new Map<string, unknown>();
  const failures = new Map<string, number>();
  const requests: string[] = [];
  const series = [
    { id: '1396', title: 'Breaking Bad', counts: [7, 13, 13, 13, 16], filmTitle: 'Le Miroir (1975)' },
    { id: '63174', title: 'Lucifer', counts: [13, 18, 26, 10, 16, 10], filmTitle: 'La Fille prodigue (1981)' },
  ];
  for (const media of series) {
    // Reproduce Vidzy's contradictory response, including its incorrect languages.
    pages.set(`${origin}/api/${media.id}`, { available: true, tmdb_id: Number(media.id), detectedType: 'movie',
      title: `${media.title} - Saison 1`, languages: ['vf'] });
    media.counts.forEach((count, index) => {
      const season = index + 1;
      pages.set(`${origin}/serie/${media.id}/${season}/1`, wrapper(media.id, season,
        Array.from({ length: count }, (_, i) => i + 1), `${media.title} - Saison ${season} Ep Array - Pilote`));
    });
    failures.set(`${origin}/serie/${media.id}/${media.counts.length + 1}/1`, 404);
    pages.set(`${origin}/movie/${media.id}`, film(media.id, media.filmTitle));
    for (const language of ['vf', 'vostfr']) {
      pages.set(`${origin}/serie/${media.id}/1/1/${language}`, wrapper(media.id, 1,
        Array.from({ length: media.counts[0] }, (_, i) => i + 1), media.title, language));
      pages.set(`${origin}/movie/${media.id}/${language}`, film(media.id, media.filmTitle, language));
      for (const key of [`${media.id}-1-${language}`, `film-${media.id}-${language}`]) {
        pages.set(`https://vidzy.cc/embed-${key}.html`,
          `videojs('v',{sources:[{src:"https://cdn.vidzy.cc/hls2/${key}/master.m3u8?token=valid",type:"application/x-mpegURL"}]})`);
      }
    }
  }
  pages.set(`${origin}/api/1399`, { available: true, tmdb_id: 1399, detectedType: 'tv',
    seasons: [{ season: 1, episodes: [1, 2] }, { season: 8, episodes: [1, 6] }] });
  // A film request must keep the film namespace even if the API selects a series.
  for (const language of ['vf', 'vostfr']) {
    pages.set(`${origin}/movie/1399/${language}`, film('1399', 'Film homonyme', language));
    pages.set(`https://vidzy.cc/embed-film-1399-${language}.html`,
      `videojs('v',{sources:[{src:"https://cdn.vidzy.cc/hls2/film-1399-${language}/master.m3u8",type:"application/x-mpegURL"}]})`);
  }
  pages.set('https://catalogue.test/v1/search?query=Lucifer', { results: [
    { id: '63174', type: 'series', title: 'Lucifer (2016)', providerId: 'vidzy' },
  ] });
  axios.defaults.adapter = (async config => {
    const url = new URL(config.url!, config.baseURL).href;
    requests.push(url);
    if (failures.has(url)) {
      const response = { data: 'Unavailable', status: failures.get(url)!, statusText: 'Error', headers: {}, config };
      throw new AxiosError('Fixture HTTP error', 'ERR_BAD_RESPONSE', config, undefined, response);
    }
    assert.ok(pages.has(url), `Unexpected request: ${url}`);
    return { data: pages.get(url), status: 200, statusText: 'OK', headers: {}, config };
  }) as AxiosAdapter;
  try {
    for (const media of series) {
      requests.length = 0;
      const provider = new VidzyProvider();
      const episodes = await provider.getEpisodes(`vidzy::${media.id}`, { type: 'series' });
      assert.equal(episodes.length, media.counts.reduce((sum, count) => sum + count, 0));
      assert.equal(episodes[0].id, `vidzy::tv::${media.id}::1::1`);
      assert.equal(episodes.at(-1)!.id, `vidzy::tv::${media.id}::${media.counts.length}::${media.counts.at(-1)}`);
      assert.equal(episodes.some(episode => episode.title === 'Film'), false);
      const streams = await provider.getStreams(episodes[0].id, episodes[0], { type: 'series' });
      assert.deepEqual(streams.map(stream => stream.language), ['VF', 'VOSTFR'], 'Use languages on the series routes');
      assert.ok(streams.every(stream => stream.url.includes(`/hls2/${media.id}-1-`)));
      assert.equal(requests.some(url => url.includes('/movie/')), false, 'Never query a film for a catalogue series');
      const before = requests.length;
      await assert.rejects(provider.getStreams(`vidzy::movie::${media.id}`, undefined, { type: 'series' }), /ancien épisode/);
      assert.equal(requests.length, before, 'Reject wrong history entries before sending requests');

      // Numeric search exposes the colliding film and series with their actual titles.
      const numeric = await provider.search(media.id);
      assert.deepEqual(numeric.map(result => [result.id, result.type, result.title]), [
        [`vidzy::${media.id}`, 'movie', media.filmTitle], [`vidzy::${media.id}`, 'series', media.title],
      ]);
    }
    requests.length = 0;
    const provider = new VidzyProvider();
    const normal = await provider.getEpisodes('vidzy::1399', { type: 'series' });
    assert.deepEqual(normal.map(episode => episode.id), [
      'vidzy::tv::1399::1::1', 'vidzy::tv::1399::1::2', 'vidzy::tv::1399::8::1', 'vidzy::tv::1399::8::6',
    ]);
    assert.deepEqual(requests, [`${origin}/api/1399`], 'Keep the existing fast path for correctly classified series');
    const movie = await provider.getEpisodes('vidzy::1399', { type: 'movie' });
    assert.equal(movie[0].id, 'vidzy::movie::1399');
    assert.ok((await provider.getStreams(movie[0].id, movie[0], { type: 'movie' })).every(stream => stream.url.includes('film-1399')));

    const searched = await new VidzyProvider({ catalogApiUrl: 'https://catalogue.test' }).search('Lucifer');
    assert.equal(searched[0].id, 'vidzy::63174', 'Preserve existing library identities');
    assert.equal(searched[0].type, 'series');

    failures.set(`${origin}/serie/1396/2/1`, 503);
    await assert.rejects(provider.getEpisodes('vidzy::1396', { type: 'series' }), /Fixture HTTP error/,
      'Do not silently truncate the season list on network or server errors');
    failures.delete(`${origin}/serie/1396/2/1`);
    failures.set(`${origin}/api/1396`, 503);
    assert.equal((await provider.getEpisodes('vidzy::1396', { type: 'series' })).length, 62,
      'A known series remains accessible when the untyped API fails');
    failures.delete(`${origin}/api/1396`);
    // A wrapper for the wrong type, season or id must not be treated as the series.
    pages.set(`${origin}/serie/1396/1/1`, film('1396', 'Le Miroir (1975)'));
    await assert.rejects(provider.getEpisodes('vidzy::1396', { type: 'series' }), /Liste des épisodes/);
    pages.set(`${origin}/serie/1396/1/1/vf`, wrapper('63174', 1, [1], 'Other series'));
    failures.set(`${origin}/serie/1396/1/1/vostfr`, 404);
    await assert.rejects(provider.getStreams('vidzy::tv::1396::1::1', undefined, { type: 'series' }), /Aucun flux/);

    assert.deepEqual(extractVidzySeriesSeason(wrapper('1396', 1, [2, 1, 2], 'Test'), '1396', 1),
      { season: 1, episodes: [1, 2] });
    assert.equal(extractVidzySeriesSeason(wrapper('1396', 1, [1], 'Test'), '1396', 2), null);
    assert.equal(extractVidzySeriesSeason('var CFG={bad JSON};', '1396', 1), null);
    assert.equal(isVidzyEpisodeForMedia('vidzy::movie::1396', { type: 'series' }), false);
    assert.equal(isVidzyEpisodeForMedia('vidzy::tv::1396::1::1', { type: 'series' }), true);
    assert.equal(isVidzyEpisodeForMedia('vidzy::tv::1396::1::1', { type: 'movie' }), false);
  } finally {
    axios.defaults.adapter = originalAdapter;
  }
}
