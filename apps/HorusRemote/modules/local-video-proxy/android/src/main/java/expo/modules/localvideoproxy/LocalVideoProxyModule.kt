package expo.modules.localvideoproxy

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import fi.iki.elonen.NanoHTTPD
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.NetworkInterface
import java.io.InputStream
import java.net.URLDecoder
import java.security.MessageDigest
import java.nio.charset.StandardCharsets
import java.util.UUID

class HlsSequenceInputStream(
    private val playlistUrl: String,
    private var segments: List<String>,
    private val referer: String?,
    private val origin: String?,
    private val userAgent: String,
    private val server: LocalVideoProxyServer
) : InputStream() {
    private var currentSegmentIndex = 0
    private var currentStream: InputStream? = null
    private var currentConnection: HttpURLConnection? = null

    private fun refreshSegments() {
        try {
            Log.d("LocalVideoProxy", "Refreshing segments from M3U8 playlist")
            val freshSegments = server.fetchSegmentsFromM3u8(playlistUrl, referer, origin, userAgent)
            if (freshSegments.isNotEmpty()) {
                segments = freshSegments
                Log.d("LocalVideoProxy", "Successfully refreshed segments. Count: ${segments.size}")
            }
        } catch (e: Exception) {
            Log.e("LocalVideoProxy", "Error refreshing segments in stream", e)
        }
    }

    private fun nextStream(): Boolean {
        currentStream?.close()
        currentConnection?.disconnect()

        if (currentSegmentIndex >= segments.size) {
            return false
        }

        val urlStr = segments[currentSegmentIndex]
        Log.d("LocalVideoProxy", "[Proxy] Pushing segment ${currentSegmentIndex + 1}/${segments.size} to TV")

        try {
            var connection = server.openHttpConnection(urlStr, referer, origin, userAgent)
            connection.connect()

            var responseCode = connection.responseCode

            // If the segment URL has expired, try to refresh all segment URLs and retry
            if (responseCode == 403 || responseCode == 410 || responseCode == 401) {
                Log.w("LocalVideoProxy", "Segment returned HTTP $responseCode (token expired). Refreshing M3U8...")
                refreshSegments()
                if (currentSegmentIndex < segments.size) {
                    val freshUrlStr = segments[currentSegmentIndex]
                    Log.d("LocalVideoProxy", "Retrying with refreshed URL...")
                    connection.disconnect()
                    connection = server.openHttpConnection(freshUrlStr, referer, origin, userAgent)
                    connection.connect()
                    responseCode = connection.responseCode
                }
            }

            if (responseCode in 200..299) {
                currentStream = connection.inputStream
                currentConnection = connection
                currentSegmentIndex++
                return true
            } else {
                Log.e("LocalVideoProxy", "Failed to load segment $responseCode")
                currentSegmentIndex++
                return nextStream()
            }
        } catch (e: Exception) {
            Log.e("LocalVideoProxy", "Exception loading segment", e)
            currentSegmentIndex++
            return nextStream()
        }
    }

    override fun read(): Int {
        if (currentStream == null && !nextStream()) return -1

        var b = currentStream?.read() ?: -1
        while (b == -1) {
            if (!nextStream()) return -1
            b = currentStream?.read() ?: -1
        }
        return b
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
        if (currentStream == null && !nextStream()) return -1

        var bytesRead = currentStream?.read(b, off, len) ?: -1
        while (bytesRead == -1) {
            if (!nextStream()) return -1
            bytesRead = currentStream?.read(b, off, len) ?: -1
        }
        return bytesRead
    }

    override fun close() {
        currentStream?.close()
        currentConnection?.disconnect()
        super.close()
    }
}

class LocalVideoProxyServer(
    port: Int,
    private val accessToken: String
) : NanoHTTPD(port) {

    private fun isAuthorized(session: IHTTPSession): Boolean {
        val providedToken = session.parameters["token"]?.firstOrNull() ?: return false
        return MessageDigest.isEqual(
            accessToken.toByteArray(StandardCharsets.UTF_8),
            providedToken.toByteArray(StandardCharsets.UTF_8)
        )
    }

    private fun requireHttpUrl(urlString: String): URL {
        val url = URL(urlString)
        val protocol = url.protocol.lowercase()
        require((protocol == "http" || protocol == "https") && url.host.isNotBlank()) {
            "Only absolute HTTP(S) URLs are allowed"
        }
        return url
    }

    fun openHttpConnection(
        urlString: String,
        referer: String?,
        origin: String?,
        userAgent: String,
        range: String? = null
    ): HttpURLConnection {
        val connection = requireHttpUrl(urlString).openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.connectTimeout = 10_000
        connection.readTimeout = 20_000
        connection.setRequestProperty("User-Agent", userAgent)
        referer
            ?.takeIf { it.startsWith("http://") || it.startsWith("https://") }
            ?.let { connection.setRequestProperty("Referer", it) }
        origin
            ?.takeIf { it.startsWith("http://") || it.startsWith("https://") }
            ?.let { connection.setRequestProperty("Origin", it) }
        range?.let { connection.setRequestProperty("Range", it) }
        return connection
    }

    private fun resolvePlaylistUri(playlistUrl: String, rawUri: String): String {
        val base = requireHttpUrl(playlistUrl)
        val raw = rawUri.trim()
        val resolved = URL(base, raw)

        // Certains CDN signent toute une playlist via la query du manifeste et
        // fournissent ensuite des segments relatifs sans répéter cette signature.
        if (!URI(raw).isAbsolute && !raw.contains("?") && resolved.query == null && base.query != null) {
            return URI(
                resolved.protocol,
                resolved.userInfo,
                resolved.host,
                resolved.port,
                resolved.path,
                base.query,
                resolved.ref
            ).toASCIIString()
        }

        return resolved.toString()
    }

    fun fetchSegmentsFromM3u8(
        playlistUrl: String,
        referer: String?,
        origin: String?,
        userAgent: String,
        depth: Int = 0
    ): List<String> {
        require(depth < 6) { "Too many nested HLS playlists" }
        requireHttpUrl(playlistUrl)
        val connection = openHttpConnection(playlistUrl, referer, origin, userAgent)
        connection.connect()

        if (connection.responseCode !in 200..299) {
            val responseCode = connection.responseCode
            connection.disconnect()
            throw IllegalStateException("HLS playlist returned HTTP $responseCode")
        }

        val text = connection.inputStream.bufferedReader().use { it.readText() }
        connection.disconnect()

        val segments = mutableListOf<String>()
        val variants = mutableListOf<Pair<Long, String>>()
        var pendingVariantBandwidth: Long? = null
        var unsupportedEncryption = false
        var usesFragmentedMp4 = false

        text.split("\n").forEach { line ->
            val trimmed = line.trim()
            if (trimmed.startsWith("#EXT-X-STREAM-INF:")) {
                pendingVariantBandwidth = Regex("""(?:^|,)BANDWIDTH=(\d+)""")
                    .find(trimmed.substringAfter(":"))
                    ?.groupValues
                    ?.get(1)
                    ?.toLongOrNull()
                    ?: 0L
            } else if (trimmed.startsWith("#EXT-X-KEY:") && !trimmed.contains("METHOD=NONE")) {
                unsupportedEncryption = true
            } else if (trimmed.startsWith("#EXT-X-MAP:")) {
                usesFragmentedMp4 = true
            } else if (trimmed.isNotBlank() && !trimmed.startsWith("#")) {
                val absoluteUrl = resolvePlaylistUri(playlistUrl, trimmed)
                val bandwidth = pendingVariantBandwidth
                if (bandwidth != null) {
                    variants.add(bandwidth to absoluteUrl)
                    pendingVariantBandwidth = null
                } else {
                    segments.add(absoluteUrl)
                }
            }
        }

        if (variants.isNotEmpty()) {
            val selectedVariant = variants.maxByOrNull { it.first }!!.second
            return fetchSegmentsFromM3u8(
                selectedVariant,
                referer,
                origin,
                userAgent,
                depth + 1
            )
        }

        require(!unsupportedEncryption) {
            "AES-encrypted HLS playlists are not supported by the DLNA MPEG-TS bridge"
        }
        require(!usesFragmentedMp4) {
            "Fragmented MP4 HLS playlists cannot be exposed as an MPEG-TS DLNA stream"
        }

        return segments
    }

    override fun serve(session: IHTTPSession): Response {
        val params = session.parameters
        val targetUrlStr = params["url"]?.get(0)
        val referer = params["referer"]?.get(0)
        val origin = params["origin"]?.get(0)
        val userAgent = params["userAgent"]?.get(0)
            ?.takeIf { it.length in 1..512 }
            ?: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

        if (!isAuthorized(session)) {
            return newFixedLengthResponse(Response.Status.UNAUTHORIZED, MIME_PLAINTEXT, "Unauthorized")
        }

        if (session.uri == "/stream.ts") {
            if (targetUrlStr == null) return newFixedLengthResponse(Response.Status.BAD_REQUEST, MIME_PLAINTEXT, "Missing URL")

            try {
                Log.d("LocalVideoProxy", "Starting authenticated HLS proxy")
                val segments = fetchSegmentsFromM3u8(targetUrlStr, referer, origin, userAgent)
                if (segments.isEmpty()) {
                    return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, "No segments found")
                }

                Log.d("LocalVideoProxy", "Found ${segments.size} segments. Starting MPEG-TS Stitching.")
                val sequenceStream = HlsSequenceInputStream(
                    targetUrlStr,
                    segments,
                    referer,
                    origin,
                    userAgent,
                    this
                )

                // On utilise le chunked response pour le "Live" MPEG-TS
                val response = newChunkedResponse(Response.Status.OK, "video/mp2t", sequenceStream)
                response.addHeader("Access-Control-Allow-Origin", "*")
                response.addHeader("transferMode.dlna.org", "Streaming")
                response.addHeader("contentFeatures.dlna.org", "DLNA.ORG_OP=00;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000")
                return response
            } catch (e: Exception) {
                Log.e("LocalVideoProxy", "Proxy stitching error", e)
                return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, e.message)
            }
        } else if (session.uri == "/proxy") {
            if (targetUrlStr == null) return newFixedLengthResponse(Response.Status.BAD_REQUEST, MIME_PLAINTEXT, "Missing URL")
            try {
                Log.d("LocalVideoProxy", "Starting authenticated media proxy")
                val connection = openHttpConnection(
                    targetUrlStr,
                    referer,
                    origin,
                    userAgent,
                    session.headers["range"]
                )

                connection.connect()
                val responseCode = connection.responseCode
                if (responseCode !in 200..299 && responseCode != 206) {
                    connection.disconnect()
                    return newFixedLengthResponse(
                        Response.Status.INTERNAL_ERROR,
                        MIME_PLAINTEXT,
                        "Upstream returned HTTP $responseCode"
                    )
                }
                val inputStream: InputStream = connection.inputStream
                val contentType = connection.contentType ?: "video/mp4"

                val status = if (responseCode == 206) Response.Status.PARTIAL_CONTENT else Response.Status.OK

                val contentLengthStr = connection.getHeaderField("Content-Length")
                val contentLength = contentLengthStr?.toLongOrNull() ?: -1L

                val response = if (contentLength >= 0) {
                    newFixedLengthResponse(status, contentType, inputStream, contentLength)
                } else {
                    newChunkedResponse(status, contentType, inputStream)
                }

                contentLengthStr?.let { response.addHeader("Content-Length", it) }
                connection.getHeaderField("Content-Range")?.let { response.addHeader("Content-Range", it) }
                connection.getHeaderField("Accept-Ranges")?.let { response.addHeader("Accept-Ranges", it) }

                return response

            } catch (e: Exception) {
                Log.e("LocalVideoProxy", "Proxy error", e)
                return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, e.message)
            }
        }
        return super.serve(session)
    }
}

class LocalVideoProxyModule : Module() {
    private var server: LocalVideoProxyServer? = null
    private var accessToken: String? = null
    private var multicastLock: android.net.wifi.WifiManager.MulticastLock? = null
    private var wakeLock: android.os.PowerManager.WakeLock? = null
    private var wifiLock: android.net.wifi.WifiManager.WifiLock? = null

    private fun acquireLocks() {
        try {
            val context = appContext.reactContext ?: return

            // WakeLock - prevents CPU sleep
            val powerManager = context.applicationContext.getSystemService(android.content.Context.POWER_SERVICE) as? android.os.PowerManager
            if (powerManager != null && wakeLock == null) {
                wakeLock = powerManager.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "Horus:LocalVideoProxyWakeLock")
                wakeLock?.setReferenceCounted(false)
            }
            if (wakeLock?.isHeld == false) {
                wakeLock?.acquire(120 * 60 * 1000L) // Limit to 2 hours max
                Log.d("LocalVideoProxy", "WakeLock acquired")
            }

            // WifiLock - keeps Wifi active and high-performance
            val wifiManager = context.applicationContext.getSystemService(android.content.Context.WIFI_SERVICE) as? android.net.wifi.WifiManager
            if (wifiManager != null && wifiLock == null) {
                wifiLock = wifiManager.createWifiLock(android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Horus:LocalVideoProxyWifiLock")
                wifiLock?.setReferenceCounted(false)
            }
            if (wifiLock?.isHeld == false) {
                wifiLock?.acquire()
                Log.d("LocalVideoProxy", "WifiLock acquired")
            }
        } catch (e: Exception) {
            Log.e("LocalVideoProxy", "Failed to acquire locks", e)
        }
    }

    private fun releaseLocks() {
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
                Log.d("LocalVideoProxy", "WakeLock released")
            }
            if (wifiLock?.isHeld == true) {
                wifiLock?.release()
                Log.d("LocalVideoProxy", "WifiLock released")
            }
        } catch (e: Exception) {
            Log.e("LocalVideoProxy", "Failed to release locks", e)
        }
    }

    private fun getLocalIpAddress(): String? {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val networkInterface = interfaces.nextElement()
                if (networkInterface.isLoopback || !networkInterface.isUp) continue
                val addresses = networkInterface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    val hostAddress = addr.hostAddress ?: continue
                    if (!addr.isLoopbackAddress && hostAddress.indexOf(':') < 0) {
                        return hostAddress
                    }
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return null
    }

    override fun definition() = ModuleDefinition {
        Name("LocalVideoProxy")

        AsyncFunction("startServer") { port: Int, promise: Promise ->
            try {
                if (server == null) {
                    accessToken = UUID.randomUUID().toString().replace("-", "")
                    server = LocalVideoProxyServer(port, accessToken!!)
                    server?.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
                    acquireLocks()
                }
                val ip = getLocalIpAddress() ?: "127.0.0.1"
                promise.resolve(mapOf(
                    "ip" to ip,
                    "token" to accessToken
                ))
            } catch (e: Exception) {
                promise.reject("ERR_SERVER_START", "Failed to start server", e)
            }
        }

        AsyncFunction("stopServer") { promise: Promise ->
            try {
                server?.stop()
                server = null
                accessToken = null
                releaseLocks()
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("ERR_SERVER_STOP", "Failed to stop server", e)
            }
        }

        AsyncFunction("acquireMulticastLock") { promise: Promise ->
            try {
                val context = appContext.reactContext
                if (context == null) {
                    promise.reject("ERR_NO_CONTEXT", "ReactContext is null, cannot acquire MulticastLock", null)
                    return@AsyncFunction
                }

                val wifiManager = context.applicationContext.getSystemService(android.content.Context.WIFI_SERVICE) as? android.net.wifi.WifiManager
                if (wifiManager == null) {
                    promise.reject("ERR_NO_WIFI_MANAGER", "WifiManager is null", null)
                    return@AsyncFunction
                }

                if (multicastLock == null) {
                    multicastLock = wifiManager.createMulticastLock("HorusDLNALock")
                    // Très important pour éviter les crashs natifs si appelé de manière asynchrone concurrente
                    multicastLock?.setReferenceCounted(false)
                }

                if (multicastLock?.isHeld == false) {
                    multicastLock?.acquire()
                    Log.d("LocalVideoProxy", "MulticastLock acquired")
                }
                promise.resolve(null)
            } catch (e: SecurityException) {
                Log.e("LocalVideoProxy", "Security exception acquiring MulticastLock (missing permission?)", e)
                promise.reject("ERR_MULTICAST_SEC", "Missing permission for MulticastLock", e)
            } catch (e: Exception) {
                Log.e("LocalVideoProxy", "Error acquiring MulticastLock", e)
                promise.reject("ERR_MULTICAST_LOCK", "Failed to acquire MulticastLock", e)
            }
        }

        AsyncFunction("releaseMulticastLock") { promise: Promise ->
            try {
                if (multicastLock != null && multicastLock?.isHeld == true) {
                    multicastLock?.release()
                    Log.d("LocalVideoProxy", "MulticastLock released")
                }
                promise.resolve(null)
            } catch (e: Exception) {
                Log.e("LocalVideoProxy", "Error releasing MulticastLock", e)
                promise.reject("ERR_MULTICAST_UNLOCK", "Failed to release MulticastLock", e)
            }
        }
    }
}
