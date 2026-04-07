import { HorusProvider, SearchResult, Episode, Stream } from '../types';
import { HttpClient } from '../utils/HttpClient';

export class AllAnimeProvider implements HorusProvider {
  name = 'AllAnime';
  private baseUrl = 'https://allanime.day';
  private apiUrl = 'https://api.allanime.day/api';
  private referer = 'https://allmanga.to';
  
  private http = HttpClient.create(this.baseUrl, this.referer);

  // Re-implementation of ani-cli custom cipher
  private decodeAllAnimeCipher(cipher: string): string {
    const map: Record<string, string> = {
      '79': 'A', '7a': 'B', '7b': 'C', '7c': 'D', '7d': 'E', '7e': 'F', '7f': 'G', '70': 'H', '71': 'I', '72': 'J',
      '73': 'K', '74': 'L', '75': 'M', '76': 'N', '77': 'O', '68': 'P', '69': 'Q', '6a': 'R', '6b': 'S', '6c': 'T',
      '6d': 'U', '6e': 'V', '6f': 'W', '60': 'X', '61': 'Y', '62': 'Z', '59': 'a', '5a': 'b', '5b': 'c', '5c': 'd',
      '5d': 'e', '5e': 'f', '5f': 'g', '50': 'h', '51': 'i', '52': 'j', '53': 'k', '54': 'l', '55': 'm', '56': 'n',
      '57': 'o', '48': 'p', '49': 'q', '4a': 'r', '4b': 's', '4c': 't', '4d': 'u', '4e': 'v', '4f': 'w', '40': 'x',
      '41': 'y', '42': 'z', '08': '0', '09': '1', '0a': '2', '0b': '3', '0c': '4', '0d': '5', '0e': '6', '0f': '7',
      '00': '8', '01': '9', '15': '-', '16': '.', '67': '_', '46': '~', '02': ':', '17': '/', '07': '?', '1b': '#',
      '63': '[', '65': ']', '78': '@', '19': '!', '1c': '$', '1e': '&', '10': '(', '11': ')', '12': '*', '13': '+',
      '14': ',', '03': ';', '05': '=', '1d': '%'
    };
    
    let decoded = '';
    for (let i = 0; i < cipher.length; i += 2) {
      const hex = cipher.toLowerCase().slice(i, i + 2);
      decoded += map[hex] || '';
    }
    
    return decoded.replace('/clock', '/clock.json');
  }

  async search(query: string): Promise<SearchResult[]> {
    const searchGql = `query( $search: SearchInput $limit: Int $page: Int $translationType: VaildTranslationTypeEnumType $countryOrigin: VaildCountryOriginEnumType ) { shows( search: $search limit: $limit page: $page translationType: $translationType countryOrigin: $countryOrigin ) { edges { _id name availableEpisodes __typename } }}`;

    const variables = {
      search: { allowAdult: false, allowUnknown: false, query },
      limit: 40,
      page: 1,
      translationType: "sub",
      countryOrigin: "ALL"
    };

    const { data } = await this.http.get(this.apiUrl, {
      params: {
        variables: JSON.stringify(variables),
        query: searchGql
      }
    });

    const results: SearchResult[] = [];
    if (data?.data?.shows?.edges) {
      for (const edge of data.data.shows.edges) {
        results.push({
          id: edge._id,
          title: edge.name,
          type: 'anime', // AllAnime usually holds anime, but could be extended
        });
      }
    }

    return results;
  }

  async getEpisodes(mediaId: string): Promise<Episode[]> {
    const episodesListGql = `query ($showId: String!) { show( _id: $showId ) { _id availableEpisodesDetail }}`;

    const { data } = await this.http.get(this.apiUrl, {
      params: {
        variables: JSON.stringify({ showId: mediaId }),
        query: episodesListGql
      }
    });

    const episodes: Episode[] = [];
    if (data?.data?.show?.availableEpisodesDetail?.sub) {
      const subEps: string[] = data.data.show.availableEpisodesDetail.sub;
      for (const ep of subEps) {
        // ID format "mediaId::epNo"
        episodes.push({
          id: `${mediaId}::${ep}`,
          number: ep,
          title: `Épisode ${ep}`
        });
      }
    }

    return episodes.sort((a, b) => parseFloat(a.number.toString()) - parseFloat(b.number.toString()));
  }

  async getStreams(episodeId: string): Promise<Stream[]> {
    const [mediaId, epNo] = episodeId.split('::');

    const episodeEmbedGql = `query ($showId: String!, $translationType: VaildTranslationTypeEnumType!, $episodeString: String!) { episode( showId: $showId translationType: $translationType episodeString: $episodeString ) { episodeString sourceUrls }}`;
    
    const { data } = await this.http.get(this.apiUrl, {
      params: {
        variables: JSON.stringify({ showId: mediaId, translationType: "sub", episodeString: epNo }),
        query: episodeEmbedGql
      }
    });

    const streams: Stream[] = [];
    const sourceUrls = data?.data?.episode?.sourceUrls || [];

    for (const source of sourceUrls) {
      const rawUrl: string = source.sourceUrl;
      const sourceName: string = source.sourceName;
      
      try {
        if (rawUrl.startsWith('--')) {
          const decryptedPath = this.decodeAllAnimeCipher(rawUrl.substring(2));
          const streamApiUrl = `${this.baseUrl}${decryptedPath}`;
          
          const streamsData = await this.http.get(streamApiUrl);
          const linksData = streamsData.data.links || [];

          for (const linkObj of linksData) {
            let directUrl = linkObj.link;
            // Sometimes it's inside `hls: { url: ... }` or `mp4: { url: ... }`
            if (linkObj.hls && linkObj.hls.url) {
              directUrl = linkObj.hls.url;
            } else if (linkObj.mp4 && linkObj.mp4.url) {
               directUrl = linkObj.mp4.url;
            }

            if (directUrl && typeof directUrl === 'string') {
              // Only keep URLs that are genuinely playable video streams
              // Skip wixmp repackager URLs (they need complex m3u8 processing the CLI does via sed)
              // Skip embed page URLs that aren't direct video files
              const isPlayable = 
                directUrl.includes('.mp4') ||
                directUrl.includes('.m3u8') ||
                directUrl.includes('fast4speed') ||
                directUrl.includes('sharepoint') ||
                directUrl.includes('akamai');

              const isEmbed = 
                directUrl.includes('repackager.wixmp.com') ||
                directUrl.includes('embed') ||
                directUrl.includes('/e/');

              if (isPlayable && !isEmbed) {
                streams.push({
                  url: directUrl,
                  quality: linkObj.resolutionStr || 'auto',
                  server: sourceName
                });
              }
            }
          }
        }
      } catch (err) {
        console.warn(`AllAnime: Failed to decode or fetch stream for ${sourceName}`, err);
      }
    }

    return streams;
  }
}
