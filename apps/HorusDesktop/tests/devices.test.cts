import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeXml, parseDevice } from "../src/services/devices";
import { mediaKey, recordHistory } from "../src/store/library";
import type { SearchResult } from "@horus/core";

test("DLNA resolves embedded renderers and relative service URLs against URLBase", () => {
  const device = parseDevice(
    "<root><URLBase>http://192.168.1.20:1400/base/</URLBase><device><deviceList><device><friendlyName>Salon</friendlyName><UDN>uuid:tv</UDN><serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>transport</controlURL></service><service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/volume</controlURL></service></serviceList></device></deviceList></device></root>",
    "http://192.168.1.20/device.xml",
  );
  assert.equal(device?.name, "Salon");
  assert.equal(device?.controlUrl, "http://192.168.1.20:1400/base/transport");
  assert.equal(device?.renderingControlUrl, "http://192.168.1.20:1400/volume");
  assert.equal(
    parseDevice(
      "<root><device><friendlyName>Printer</friendlyName></device></root>",
      "http://192.168.1.20/",
    ),
    undefined,
  );
});

test("SOAP values escape titles and signed URLs without creating XML elements", () => {
  assert.equal(
    escapeXml('A & B <movie> "x"'),
    "A &amp; B &lt;movie&gt; &quot;x&quot;",
  );
  assert.equal(
    escapeXml("https://x.test/v?a=1&b=2"),
    "https://x.test/v?a=1&amp;b=2",
  );
});

test("history resumes the latest episode without merging different providers", () => {
  const media: SearchResult = {
    id: "42",
    title: "Example",
    type: "series",
    providerId: "vidzy",
  };
  const other = { ...media, providerId: "anime-sama" as const };
  const first = {
    media,
    episode: { id: "1", number: 1 },
    position: 10,
    duration: 100,
    updatedAt: 1,
  };
  const second = {
    ...first,
    episode: { id: "2", number: 2 },
    position: 20,
    updatedAt: 2,
  };
  const history = recordHistory([first, { ...first, media: other }], second);
  assert.equal(history.length, 2);
  assert.equal(history[0].episode.id, "2");
  assert.notEqual(mediaKey(history[0].media), mediaKey(history[1].media));
  assert.equal(
    recordHistory(
      Array.from({ length: 250 }, (_, i) => ({
        ...first,
        media: { ...media, id: String(i) },
      })),
      second,
    ).length,
    200,
  );
});
