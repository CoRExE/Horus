/**
 * Service pour contrôler un appareil DLNA / UPnP via SOAP
 */
import { inferStreamFormat, Stream } from '@horus/core';
import LocalVideoProxy from '../modules/local-video-proxy/src/LocalVideoProxyModule';

const buildSoapMessage = (action: string, args: Record<string, string>) => {
  const argsXml = Object.keys(args)
    .map(key => `<${key}>${args[key]}</${key}>`)
    .join('');

  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <u:${action} xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
      ${argsXml}
    </u:${action}>
  </s:Body>
</s:Envelope>`;
};

const sendSoapCommand = async (controlUrl: string, action: string, args: Record<string, string> = {}) => {
  const soapMessage = buildSoapMessage(action, args);
  console.log(`[DLNA] Sending SOAP Action ${action} to ${controlUrl}`);
  
  try {
    const response = await fetch(controlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPAction': `"urn:schemas-upnp-org:service:AVTransport:1#${action}"`
      },
      body: soapMessage
    });

    const text = await response.text();
    if (!response.ok) {
      // L'erreur 701 "Transition Not Available" est normale si on essaie de Stopper, 
      // Mettre en pause ou Jouer alors que l'appareil est déjà dans cet état (ex: pause via télécommande TV)
      if (text.includes('701')) {
        console.log(`[DLNA] SOAP Action ${action} ignorée (Déjà dans cet état ou action indisponible).`);
        return text;
      }
      console.error(`[DLNA] SOAP Error ${response.status}:`, text);
      throw new Error(`SOAP Action ${action} failed with status ${response.status}`);
    }
    
    console.log(`[DLNA] SOAP Action ${action} successful.`);
    return text;
  } catch (err) {
    // Si c'est une erreur réseau (timeout, offline), on ignore silencieusement pour le Stop
    if (action === 'Stop') {
      console.log(`[DLNA] Arrêt forcé en local (TV injoignable).`);
      return '';
    }
    console.error(`[DLNA] Network Error sending SOAP ${action}:`, err);
    throw err;
  }
};

const escapeXml = (unsafe: string) => {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

const getContentType = (url: string) => {
  if (url.includes('/stream.ts')) return 'video/mp2t';
  if (url.toLowerCase().includes('.m3u8')) return 'application/vnd.apple.mpegurl';
  return 'video/mp4';
};

const prepareRemoteStream = async (
  stream: Pick<Stream, 'url' | 'format' | 'headers'>,
  options: { bridgeHls?: boolean } = {}
) => {
  const videoUrl = stream.url;
  const headers = stream.headers;
  const referer = headers?.Referer || headers?.referer;
  const origin = headers?.Origin || headers?.origin;
  const userAgent = headers?.['User-Agent'] || headers?.['user-agent'];
  const format = inferStreamFormat(stream);
  const bridgeHls = options.bridgeHls ?? true;

  // La plupart des renderers DLNA ne savent pas lire un manifeste HLS.
  // Même sans Referer, le téléphone transforme donc le HLS en MPEG-TS continu.
  const requiresProxy = (format === 'hls' && bridgeHls) || Boolean(referer || origin || userAgent);
  if (!requiresProxy) {
    return { url: videoUrl, contentType: getContentType(videoUrl) };
  }

  const { ip, token } = await LocalVideoProxy.startServer(8080);
  // Un HLS protégé doit également être assemblé : un simple proxy du manifeste
  // ne pourrait pas injecter ses en-têtes dans les requêtes de segments.
  const proxyPath = format === 'hls' ? '/stream.ts' : '/proxy';
  const queryValues: Record<string, string> = {
    token,
    url: videoUrl,
  };
  if (referer) queryValues.referer = referer;
  if (origin) queryValues.origin = origin;
  if (userAgent) queryValues.userAgent = userAgent;
  const query = new URLSearchParams(queryValues);

  return {
    url: `http://${ip}:8080${proxyPath}?${query.toString()}`,
    contentType: getContentType(proxyPath),
  };
};

export const dlnaController = {
  prepareRemoteStream,

  /**
   * Envoie la vidéo à la TV
   */
  castVideo: async (
    controlUrl: string,
    stream: Pick<Stream, 'url' | 'format' | 'headers'>,
    title: string
  ) => {
    const preparedStream = await prepareRemoteStream(stream);
    const finalUrl = preparedStream.url;

    // Les métadonnées DIDL-Lite strictes
    const escapedTitle = escapeXml(title);
    const escapedVideoUrl = escapeXml(finalUrl);
    
    // Déduction du type MIME
    const mimeType = preparedStream.contentType;
    
    // Les box strictes requièrent un protocolInfo valide dans la balise <res>
    const protocolInfo = `http-get:*:${mimeType}:*`;

    const metaData = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
  <item id="1" parentID="0" restricted="1">
    <dc:title>${escapedTitle}</dc:title>
    <upnp:class>object.item.videoItem</upnp:class>
    <res protocolInfo="${protocolInfo}">${escapedVideoUrl}</res>
  </item>
</DIDL-Lite>`;

    // On échappe une deuxième fois pour l'inclure dans la requête SOAP XML
    const escapedMetaData = escapeXml(metaData);

    // 1. Définir l'URI (SetAVTransportURI)
    await sendSoapCommand(controlUrl, 'SetAVTransportURI', {
      CurrentURI: escapedVideoUrl,
      CurrentURIMetaData: escapedMetaData
    });

    // Attendre 1.5 seconde que la Box traite l'URI et charge le buffer initial
    console.log('[DLNA] Waiting 1.5s for Box to transition...');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 2. Lancer la lecture (Play)
    await sendSoapCommand(controlUrl, 'Play', {
      Speed: '1'
    });
  },

  play: async (controlUrl: string) => {
    await sendSoapCommand(controlUrl, 'Play', { Speed: '1' });
  },

  pause: async (controlUrl: string) => {
    await sendSoapCommand(controlUrl, 'Pause');
  },

  stop: async (controlUrl: string) => {
    await sendSoapCommand(controlUrl, 'Stop');
  }
};
