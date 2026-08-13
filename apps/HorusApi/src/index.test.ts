import assert from 'node:assert/strict';
import test from 'node:test';
import { mapTmdbResults, searchTmdb } from './index';

test('maps only safe movie and TV results', () => {
  assert.deepEqual(mapTmdbResults({
    results: [
      {
        id: 35,
        media_type: 'movie',
        title: 'Les Simpson, le film',
        release_date: '2007-07-25',
        poster_path: '/poster.jpg',
      },
      {
        id: 110492,
        media_type: 'tv',
        name: 'Peacemaker',
        first_air_date: '2022-01-13',
      },
      { id: 1, media_type: 'person', name: 'Ignored' },
      { id: 2, media_type: 'movie', title: 'Adult', adult: true },
    ],
  }), [
    {
      id: '35',
      title: 'Les Simpson, le film (2007)',
      coverUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
      type: 'movie',
      providerId: 'vidzy',
      year: 2007,
    },
    {
      id: '110492',
      title: 'Peacemaker (2022)',
      coverUrl: undefined,
      type: 'series',
      providerId: 'vidzy',
      year: 2022,
    },
  ]);
});

test('uses bearer authentication and French search parameters', async () => {
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/3/search/multi');
    assert.equal(url.searchParams.get('query'), 'Dune');
    assert.equal(url.searchParams.get('language'), 'fr-FR');
    assert.equal(url.searchParams.get('include_adult'), 'false');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-token');
    return Response.json({ page: 1, total_pages: 1, total_results: 0, results: [] });
  };

  const result = await searchTmdb('Dune', 1, 'test-token', fetcher);
  assert.deepEqual(result, {
    page: 1,
    totalPages: 1,
    totalResults: 0,
    results: [],
  });
});
