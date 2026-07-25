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
  renderingControlUrl?: string;
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

const fetchWithTimeout = async (url: string, timeoutMs = 5_000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

export const useDlnaDiscovery = () => {
  const [devices, setDevices] = useState<Record<string, DlnaDevice>>({});
  const [isSearching, setIsSearching] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const socketRef = useRef<any>(null);
  const timersRef = useRef<NodeJS.Timeout[]>([]);
  const seenLocationsRef = useRef(new Set<string>());

  const addLog = useCallback((msg: string, isError = false) => {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${msg}`;
    if (isError) {
      console.error(formatted);
    } else {
      console.log(formatted);
    }
    setLogs(prev => [...prev.slice(-30), formatted]); // Keep last 30 logs
  }, []);

  // Cleanup function: close socket, release lock, clear timers
  const cleanup = useCallback(async () => {
    // Clear all pending timers
    timersRef.current.forEach(t => clearTimeout(t));
    timersRef.current = [];

    // Close socket
    if (socketRef.current) {
      try {
        socketRef.current.close();
        addLog('Socket closed.');
      } catch (e: any) {
        addLog(`Error closing socket: ${e.message}`, true);
      }
      socketRef.current = null;
    }

    // Release multicast lock on Android
    if (Platform.OS === 'android') {
      try {
        await LocalVideoProxy?.releaseMulticastLock?.();
        addLog('MulticastLock released');
      } catch (e: any) {
        addLog(`Error releasing MulticastLock: ${e.message || e}`, true);
      }
    }

    setIsSearching(false);
  }, [addLog]);

  const startDiscovery = useCallback(() => {
    const run = async () => {
      await cleanup();
      setIsSearching(true);
      setDevices({});
      setLogs([]);
      seenLocationsRef.current.clear();
      addLog('Starting DLNA discovery...');

      // Acquire multicast lock on Android (required for UDP multicast in Release)
      if (Platform.OS === 'android') {
        try {
          addLog('Acquiring MulticastLock...');
          await LocalVideoProxy?.acquireMulticastLock?.();
          addLog('MulticastLock acquired successfully!');
        } catch (e: any) {
          addLog(`Error acquiring MulticastLock: ${e.message || e}`, true);
        }
      }

      let socket: any;
      try {
        addLog('Creating UDP socket...');
        socket = dgram.createSocket({ type: 'udp4' });
      } catch (e: any) {
        addLog(`Failed to create UDP socket: ${e.message}`, true);
        setIsSearching(false);
        return;
      }

      socketRef.current = socket;

      socket.on('error', (err: any) => {
        addLog(`Socket error: ${err.message || err}`, true);
      });

      socket.on('message', async (msg: any, rinfo: any) => {
        try {
          const response = msg.toString();

          // Look for the LOCATION header
          const locationMatch = response.match(/LOCATION:\s*(http:\/\/[^\r\n]+)/i);
          if (!locationMatch || !locationMatch[1]) return;

          const locationUrl = locationMatch[1].trim();
          addLog(`Discovered raw SSDP target at ${rinfo.address}. Location: ${locationUrl}`);

          if (seenLocationsRef.current.has(locationUrl)) {
            addLog(`Device at ${locationUrl} already exists in list, skipping fetch.`);
            return;
          }
          seenLocationsRef.current.add(locationUrl);

          addLog(`Fetching XML description from ${locationUrl}...`);
          try {
            const res = await fetchWithTimeout(locationUrl);
            addLog(`Fetch response status: ${res.status} for ${locationUrl}`);
            const xmlText = await res.text();
            addLog(`Fetched ${xmlText.length} bytes of XML from ${locationUrl}`);

            const parser = new XMLParser({ ignoreAttributes: false });
            const parsed = parser.parse(xmlText);

            const deviceNode = parsed?.root?.device;
            if (!deviceNode) {
              addLog(`Invalid XML description (missing device node) from ${locationUrl}`, true);
              return;
            }

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
            const renderingControl = services.find(s => s.serviceType?.includes('RenderingControl'));

            if (avTransport && avTransport.controlURL) {
               const serviceBaseUrl = parsed?.root?.URLBase || locationUrl;
               controlUrl = new URL(avTransport.controlURL, serviceBaseUrl).toString();
               const renderingControlUrl = renderingControl?.controlURL
                 ? new URL(renderingControl.controlURL, serviceBaseUrl).toString()
                 : undefined;

               const newDevice: DlnaDevice = {
                 id: udn,
                 ip: rinfo.address,
                 name,
                 controlUrl,
                 renderingControlUrl,
                 location: locationUrl
               };

               addLog(`Device parse successful! Name: "${name}" UDN: ${udn}`);
               setDevices(prev => ({
                 ...prev,
                 [udn]: newDevice
               }));
            } else {
               addLog(`Device parsed but no AVTransport service found at ${locationUrl}`, true);
            }
          } catch (error: any) {
            addLog(`Failed to fetch or parse DLNA description from ${locationUrl}: ${error.message || error}`, true);
          }
        } catch (error: any) {
          addLog(`Error handling incoming message: ${error.message || error}`, true);
        }
      });

      socket.bind(0, () => {
        try {
          addLog('UDP socket bound successfully. Sending SSDP M-SEARCH...');
          const message = Buffer.from(M_SEARCH);

          const sendSearch = () => {
            if (!socketRef.current) return;
            addLog('Sending SSDP M-SEARCH packet...');
            socket.send(message, 0, message.length, SSDP_PORT, SSDP_IP, (err: any) => {
              if (err) addLog(`SSDP Send Error: ${err.message || err}`, true);
              else addLog('SSDP M-SEARCH packet sent.');
            });
          };

          sendSearch();
          timersRef.current.push(setTimeout(sendSearch, 1000));
          timersRef.current.push(setTimeout(sendSearch, 2000));
        } catch (e: any) {
          addLog(`Error sending M-SEARCH: ${e.message}`, true);
        }
      });

      // Stop searching after 5 seconds
      timersRef.current.push(setTimeout(() => {
        addLog('Discovery timeout reached. Ending search...');
        void cleanup();
      }, 5000));
    };

    run().catch(err => {
      addLog(`Critical error during discovery: ${err.message || err}`, true);
      void cleanup();
    });
  }, [cleanup, addLog]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      void cleanup();
    };
  }, [cleanup]);

  return {
    devices: Object.values(devices),
    isSearching,
    startDiscovery,
    logs
  };
};
