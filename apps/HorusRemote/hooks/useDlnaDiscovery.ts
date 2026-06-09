import { useState, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import dgram from 'react-native-udp';
import { XMLParser } from 'fast-xml-parser';
import { Buffer } from 'buffer';
import LocalVideoProxy from '../modules/local-video-proxy/src/LocalVideoProxyModule';

export interface DlnaDevice {
  id: string; // uuid
  ip: string;
  name: string;
  controlUrl: string;
  location: string; // The URL to device description
}

const SSDP_PORT = 1900;
const SSDP_IP = '239.255.255.250';
const SEARCH_TARGET = 'urn:schemas-upnp-org:service:AVTransport:1';

const M_SEARCH = 
  'M-SEARCH * HTTP/1.1\r\n' +
  `HOST: ${SSDP_IP}:${SSDP_PORT}\r\n` +
  'MAN: "ssdp:discover"\r\n' +
  'MX: 3\r\n' +
  `ST: ${SEARCH_TARGET}\r\n` +
  '\r\n';

export const useDlnaDiscovery = () => {
  const [devices, setDevices] = useState<Record<string, DlnaDevice>>({});
  const [isSearching, setIsSearching] = useState(false);
  const socketRef = useRef<any>(null);
  const timersRef = useRef<NodeJS.Timeout[]>([]);

  // Cleanup function: close socket, release lock, clear timers
  const cleanup = useCallback(() => {
    // Clear all pending timers
    timersRef.current.forEach(t => clearTimeout(t));
    timersRef.current = [];

    // Close socket
    if (socketRef.current) {
      try { socketRef.current.close(); } catch (e) { /* ignore */ }
      socketRef.current = null;
    }

    // Release multicast lock on Android
    if (Platform.OS === 'android') {
      try {
        LocalVideoProxy?.releaseMulticastLock?.()?.catch?.((e: any) => 
          console.warn('[DLNA] Error releasing MulticastLock:', e)
        );
      } catch (e) {
        console.warn('[DLNA] Sync error releasing MulticastLock:', e);
      }
    }

    setIsSearching(false);
  }, []);

  const startDiscovery = useCallback(() => {
    // Cleanup any previous discovery session
    cleanup();

    setIsSearching(true);
    setDevices({});

    const run = async () => {
      // Acquire multicast lock on Android (required for UDP multicast in Release)
      if (Platform.OS === 'android') {
        try {
          await LocalVideoProxy?.acquireMulticastLock?.();
          console.log('[DLNA] MulticastLock acquired');
        } catch (e) {
          console.error("[DLNA] Error acquiring MulticastLock:", e);
          // Continue anyway — discovery might still work on some devices
        }
      }

      let socket: any;
      try {
        socket = dgram.createSocket('udp4');
      } catch (e) {
        console.error('[DLNA] Failed to create UDP socket:', e);
        setIsSearching(false);
        return;
      }

      socketRef.current = socket;

      socket.on('error', (err: any) => {
        console.error('[DLNA] Socket error:', err);
      });

      socket.on('message', async (msg: any, rinfo: any) => {
        try {
          const response = msg.toString();
          
          // Look for the LOCATION header
          const locationMatch = response.match(/LOCATION:\s*(http:\/\/[^\r\n]+)/i);
          if (!locationMatch || !locationMatch[1]) return;

          const locationUrl = locationMatch[1].trim();
          
          // Skip if we already know this location
          setDevices(prev => {
            if (Object.values(prev).some(d => d.location === locationUrl)) return prev;
            return prev;
          });

          const res = await fetch(locationUrl);
          const xmlText = await res.text();
          
          const parser = new XMLParser({ ignoreAttributes: false });
          const parsed = parser.parse(xmlText);
          
          const deviceNode = parsed?.root?.device;
          if (!deviceNode) return;

          const name = deviceNode.friendlyName || 'Unknown Device';
          const udn = deviceNode.UDN || rinfo.address;
          
          let controlUrl = '';
          const services: any[] = [];
          const extractServices = (node: any) => {
             if (node.serviceList && node.serviceList.service) {
                const s = node.serviceList.service;
                if (Array.isArray(s)) services.push(...s);
                else services.push(s);
             }
             if (node.deviceList && node.deviceList.device) {
                const d = node.deviceList.device;
                if (Array.isArray(d)) d.forEach(extractServices);
                else extractServices(d);
             }
          };
          
          extractServices(deviceNode);
          
          const avTransport = services.find(s => s.serviceType?.includes('AVTransport'));
          
          if (avTransport && avTransport.controlURL) {
             const baseUrl = new URL(locationUrl);
             const cUrl = avTransport.controlURL.startsWith('/') 
               ? avTransport.controlURL 
               : `/${avTransport.controlURL}`;
               
             controlUrl = `${baseUrl.origin}${cUrl}`;
             
             const newDevice: DlnaDevice = {
               id: udn,
               ip: rinfo.address,
               name,
               controlUrl,
               location: locationUrl
             };
             
             setDevices(prev => ({
               ...prev,
               [udn]: newDevice
             }));
          }
        } catch (error) {
          console.log('[DLNA] Failed to fetch/parse device description:', error);
        }
      });

      socket.bind(0, () => {
        try {
          const message = Buffer.from(M_SEARCH);
          
          const sendSearch = () => {
            if (!socketRef.current) return; // Socket was closed
            socket.send(message, 0, message.length, SSDP_PORT, SSDP_IP, (err: any) => {
              if (err) console.error('[DLNA] SSDP Send Error:', err);
            });
          };
          
          sendSearch();
          timersRef.current.push(setTimeout(sendSearch, 1000));
          timersRef.current.push(setTimeout(sendSearch, 2000));
        } catch (e) {
          console.error('[DLNA] Error sending M-SEARCH:', e);
        }
      });

      // Stop searching after 5 seconds
      timersRef.current.push(setTimeout(() => {
        cleanup();
      }, 5000));
    };

    run().catch(err => {
      console.error('[DLNA] Critical error during discovery:', err);
      cleanup();
    });
  }, [cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return { 
    devices: Object.values(devices), 
    isSearching,
    startDiscovery
  };
};
