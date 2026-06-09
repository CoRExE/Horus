import { useState, useEffect, useCallback } from 'react';
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

  useEffect(() => {
    let socket: any = null;

    const startDiscovery = async () => {
      setIsSearching(true);
      setDevices({}); // Clear previous devices
      
      if (Platform.OS === 'android') {
        try {
          await LocalVideoProxy?.acquireMulticastLock?.();
          console.log("[DLNA] MulticastLock acquis !");
        } catch (e) {
          console.error("[DLNA] Erreur d'acquisition du MulticastLock", e);
        }
      }

      // @ts-ignore : the react-native-udp types might not perfectly match Node's dgram
      socket = dgram.createSocket('udp4');

      socket.on('message', async (msg: any, rinfo: any) => {
        const response = msg.toString();
        
        // Look for the LOCATION header
        const locationMatch = response.match(/LOCATION:\s*(http:\/\/[^\r\n]+)/i);
        if (locationMatch && locationMatch[1]) {
          const locationUrl = locationMatch[1].trim();
          
          setDevices(prev => {
            if (Object.values(prev).some(d => d.location === locationUrl)) return prev;
            return prev;
          });

          try {
            const res = await fetch(locationUrl);
            const xmlText = await res.text();
            
            const parser = new XMLParser({ ignoreAttributes: false });
            const parsed = parser.parse(xmlText);
            
            const deviceNode = parsed?.root?.device;
            if (deviceNode) {
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
            }
          } catch (error) {
            console.log(`Failed to fetch or parse DLNA description from ${locationUrl}`, error);
          }
        }
      });

      socket.bind(0, () => {
        const message = Buffer.from(M_SEARCH);
        
        const sendSearch = () => {
          socket.send(message, 0, message.length, SSDP_PORT, SSDP_IP, (err: any) => {
            if (err) console.error('[DLNA] SSDP Send Error:', err);
          });
        };
        
        sendSearch();
        setTimeout(sendSearch, 1000);
        setTimeout(sendSearch, 2000);
      });

      // Stop searching after 5 seconds automatically
      setTimeout(() => {
        if (socket) {
          try { socket.close(); } catch (e) {}
        }
        if (Platform.OS === 'android') {
          LocalVideoProxy?.releaseMulticastLock?.()?.catch((e: any) => console.error(e));
        }
        setIsSearching(false);
      }, 5000);
    };

    startDiscovery().catch(err => {
      console.error("[DLNA] Critical error during discovery start:", err);
    });

    return () => {
      if (socket) {
        try { socket.close(); } catch (e) {}
      }
      if (Platform.OS === 'android') {
        LocalVideoProxy?.releaseMulticastLock?.()?.catch((e: any) => console.error(e));
      }
      setIsSearching(false);
    };
  }, []);

  return { 
    devices: Object.values(devices), 
    isSearching 
  };
};
