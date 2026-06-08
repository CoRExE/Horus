import { useState, useEffect, useCallback } from 'react';
import dgram from 'react-native-udp';
import { XMLParser } from 'fast-xml-parser';
import { Buffer } from 'buffer';

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

  const startDiscovery = useCallback(() => {
    setIsSearching(true);
    setDevices({}); // Clear previous devices
    
    // @ts-ignore : the react-native-udp types might not perfectly match Node's dgram, but the API is similar
    const socket = dgram.createSocket('udp4');

    socket.bind(0, () => {
      // Once bound, send the multicast message
      const message = Buffer.from(M_SEARCH);
      socket.send(message, 0, message.length, SSDP_PORT, SSDP_IP, (err) => {
        if (err) console.error("SSDP Send Error:", err);
      });
    });

    socket.on('message', async (msg, rinfo) => {
      const response = msg.toString();
      
      // Look for the LOCATION header
      const locationMatch = response.match(/LOCATION:\s*(.+)\r/i);
      if (locationMatch && locationMatch[1]) {
        const locationUrl = locationMatch[1].trim();
        
        // Eviter de parser plusieurs fois la même URL
        setDevices(prev => {
           if (Object.values(prev).some(d => d.location === locationUrl)) return prev;
           return prev; // We will actually update it after fetching XML
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
            
            // Chercher le service AVTransport pour trouver l'URL de contrôle
            let controlUrl = '';
            
            // Le XML peut avoir un ou plusieurs services, souvent imbriqués dans serviceList
            const services = [];
            const extractServices = (node: any) => {
               if (node.serviceList && node.serviceList.service) {
                  const s = node.serviceList.service;
                  if (Array.isArray(s)) services.push(...s);
                  else services.push(s);
               }
               // Check sub-devices recursively
               if (node.deviceList && node.deviceList.device) {
                  const d = node.deviceList.device;
                  if (Array.isArray(d)) d.forEach(extractServices);
                  else extractServices(d);
               }
            };
            
            extractServices(deviceNode);
            
            const avTransport = services.find(s => s.serviceType?.includes('AVTransport'));
            
            if (avTransport && avTransport.controlURL) {
               // Construire l'URL de contrôle absolue
               const baseUrl = new URL(locationUrl);
               // Gérer le fait que controlURL peut commencer par / ou non
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

    // Stop searching after 5 seconds
    setTimeout(() => {
      socket.close();
      setIsSearching(false);
    }, 5000);

  }, []);

  return {
    devices: Object.values(devices),
    isSearching,
    startDiscovery
  };
};
