import axios, { AxiosInstance } from 'axios';

export class HttpClient {
  static create(baseURL?: string, referer?: string): AxiosInstance {
    return axios.create({
      baseURL,
      timeout: 15_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        ...(referer ? { 'Referer': referer } : {})
      }
    });
  }
}
