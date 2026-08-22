export interface Env {
  TMDB_READ_TOKEN: string;
}

interface TmdbSearchItem {
  id?: number;
  media_type?: string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  adult?: boolean;
}

interface TmdbSearchResponse {
  page?: number;
  total_pages?: number;
  total_results?: number;
  results?: TmdbSearchItem[];
}

export interface HorusCatalogResult {
  id: string;
  title: string;
  coverUrl?: string;
  type: 'movie' | 'series';
  providerId: 'vidzy';
  year?: number;
}

const SEARCH_LIMIT_PER_MINUTE = 60;
const searchWindows = new Map<string, { startedAt: number; count: number }>();

const json = (value: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });

export const consumeSearchQuota = (clientId: string, now = Date.now()) => {
  const current = searchWindows.get(clientId);
  if (!current || now - current.startedAt >= 60_000) {
    searchWindows.set(clientId, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= SEARCH_LIMIT_PER_MINUTE) return false;
  current.count += 1;
  if (searchWindows.size > 2_048) {
    for (const [key, value] of searchWindows) {
      if (now - value.startedAt >= 60_000) searchWindows.delete(key);
    }
  }
  return true;
};

const readYear = (value?: string) => {
  const year = Number(value?.slice(0, 4));
  return Number.isInteger(year) && year > 1800 ? year : undefined;
};

export const mapTmdbResults = (payload: TmdbSearchResponse): HorusCatalogResult[] =>
  (payload.results || []).flatMap(item => {
    if (
      !item.id ||
      item.adult === true ||
      (item.media_type !== 'movie' && item.media_type !== 'tv')
    ) {
      return [];
    }

    const title = item.media_type === 'movie' ? item.title : item.name;
    if (!title) return [];
    const year = readYear(
      item.media_type === 'movie' ? item.release_date : item.first_air_date
    );

    return [{
      id: String(item.id),
      title: year ? `${title} (${year})` : title,
      coverUrl: item.poster_path
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
        : undefined,
      type: item.media_type === 'movie' ? 'movie' : 'series',
      providerId: 'vidzy',
      year,
    }];
  });

export const searchTmdb = async (
  query: string,
  page: number,
  token: string,
  fetcher: typeof fetch = fetch
) => {
  const url = new URL('https://api.themoviedb.org/3/search/multi');
  url.searchParams.set('query', query);
  url.searchParams.set('page', String(page));
  url.searchParams.set('language', 'fr-FR');
  url.searchParams.set('include_adult', 'false');

  const response = await fetcher(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`TMDB request failed with status ${response.status}`);
  }

  const payload = await response.json<TmdbSearchResponse>();
  return {
    page: payload.page || page,
    totalPages: payload.total_pages || 0,
    totalResults: payload.total_results || 0,
    results: mapTmdbResults(payload),
  };
};

const handleSearch = async (request: Request, env: Env, ctx: ExecutionContext) => {
  if (!env.TMDB_READ_TOKEN) {
    return json({ error: 'TMDB is not configured' }, 503);
  }

  const url = new URL(request.url);
  const clientId = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!consumeSearchQuota(clientId)) {
    return json({ error: 'Too many search requests' }, 429, { 'Retry-After': '60' });
  }
  const query = (url.searchParams.get('query') || '').trim();
  const requestedPage = Number(url.searchParams.get('page') || '1');
  const page = Number.isInteger(requestedPage)
    ? Math.min(500, Math.max(1, requestedPage))
    : 1;
  if (query.length < 2 || query.length > 120) {
    return json({ error: 'query must contain between 2 and 120 characters' }, 400);
  }

  const cacheUrl = new URL(request.url);
  cacheUrl.search = new URLSearchParams({ query, page: String(page) }).toString();
  const cacheKey = new Request(cacheUrl, { method: 'GET' });
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  try {
    const result = await searchTmdb(query, page, env.TMDB_READ_TOKEN);
    const response = json(result, 200, {
      'Cache-Control': 'public, max-age=300, s-maxage=21600',
    });
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    console.error('TMDB search failed', error);
    return json({ error: 'TMDB is temporarily unavailable' }, 502);
  }
};

export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { Allow: 'GET, OPTIONS' },
      });
    }
    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, OPTIONS' });
    }

    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json({ status: 'ok' });
    }
    if (url.pathname === '/v1/search') {
      return handleSearch(request, env, ctx);
    }
    return json({ error: 'Not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
