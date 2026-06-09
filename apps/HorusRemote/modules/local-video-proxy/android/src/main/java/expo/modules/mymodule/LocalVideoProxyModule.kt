package expo.modules.mymodule

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import fi.iki.elonen.NanoHTTPD
import java.net.HttpURLConnection
import java.net.URL
import java.net.NetworkInterface
import java.io.InputStream
import java.net.URLDecoder

class HlsSequenceInputStream(private val segments: List<String>, private val referer: String?, private val userAgent: String) : InputStream() {
    private var currentSegmentIndex = 0
    private var currentStream: InputStream? = null
    private var currentConnection: HttpURLConnection? = null

    private fun nextStream(): Boolean {
        currentStream?.close()
        currentConnection?.disconnect()
        
        if (currentSegmentIndex >= segments.size) {
            return false
        }
        
        val urlStr = segments[currentSegmentIndex]
        Log.d("LocalVideoProxy", "[Proxy] Pushing segment ${currentSegmentIndex + 1}/${segments.size} to TV")
        
        try {
            val url = URL(urlStr)
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.setRequestProperty("User-Agent", userAgent)
            referer?.let { connection.setRequestProperty("Referer", it) }
            connection.connect()
            
            if (connection.responseCode in 200..299) {
                currentStream = connection.inputStream
                currentConnection = connection
                currentSegmentIndex++
                return true
            } else {
                Log.e("LocalVideoProxy", "Failed to load segment ${connection.responseCode}")
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

class LocalVideoProxyServer(port: Int) : NanoHTTPD(port) {

    private fun fetchSegmentsFromM3u8(playlistUrl: String, referer: String?, userAgent: String): List<String> {
        val url = URL(playlistUrl)
        val connection = url.openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.setRequestProperty("User-Agent", userAgent)
        referer?.let { connection.setRequestProperty("Referer", it) }
        connection.connect()

        if (connection.responseCode !in 200..299) return emptyList()

        val text = connection.inputStream.bufferedReader().use { it.readText() }
        val baseUrl = if (playlistUrl.contains("?")) playlistUrl.substringBefore("?") else playlistUrl
        val basePath = baseUrl.substringBeforeLast("/") + "/"

        val segments = mutableListOf<String>()
        var isMasterPlaylist = false

        text.split("\n").forEach { line ->
            val trimmed = line.trim()
            if (trimmed.startsWith("#EXT-X-STREAM-INF:")) {
                isMasterPlaylist = true
            } else if (trimmed.isNotBlank() && !trimmed.startsWith("#")) {
                val absoluteUrl = when {
                    trimmed.startsWith("http") -> trimmed
                    trimmed.startsWith("/") -> {
                        val urlObj = URL(playlistUrl)
                        "${urlObj.protocol}://${urlObj.host}${if (urlObj.port != -1) ":" + urlObj.port else ""}$trimmed"
                    }
                    else -> basePath + trimmed
                }
                segments.add(absoluteUrl)
            }
        }

        if (isMasterPlaylist && segments.isNotEmpty()) {
            // Prendre la sous-playlist (on prend la dernière, souvent de meilleure qualité)
            return fetchSegmentsFromM3u8(segments.last(), referer, userAgent)
        }

        return segments
    }

    override fun serve(session: IHTTPSession): Response {
        val params = session.parameters
        val targetUrlStr = params["url"]?.get(0)
        val referer = params["referer"]?.get(0)
        val userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

        if (session.uri == "/stream.ts") {
            if (targetUrlStr == null) return newFixedLengthResponse(Response.Status.BAD_REQUEST, MIME_PLAINTEXT, "Missing URL")
            
            try {
                Log.d("LocalVideoProxy", "Stitching M3U8: $targetUrlStr")
                val segments = fetchSegmentsFromM3u8(targetUrlStr, referer, userAgent)
                if (segments.isEmpty()) {
                    return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, "No segments found")
                }
                
                Log.d("LocalVideoProxy", "Found ${segments.size} segments. Starting MPEG-TS Stitching.")
                val sequenceStream = HlsSequenceInputStream(segments, referer, userAgent)
                
                // On utilise le chunked response pour le "Live" MPEG-TS
                val response = newChunkedResponse(Response.Status.OK, "video/mp2t", sequenceStream)
                response.addHeader("Access-Control-Allow-Origin", "*")
                return response
            } catch (e: Exception) {
                Log.e("LocalVideoProxy", "Proxy stitching error", e)
                return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, e.message)
            }
        } else if (session.uri == "/proxy") {
            if (targetUrlStr == null) return newFixedLengthResponse(Response.Status.BAD_REQUEST, MIME_PLAINTEXT, "Missing URL")
            try {
                Log.d("LocalVideoProxy", "Proxying to: $targetUrlStr with referer $referer")
                val url = URL(targetUrlStr)
                val connection = url.openConnection() as HttpURLConnection
                connection.requestMethod = "GET"
                connection.setRequestProperty("User-Agent", userAgent)
                if (referer != null && referer.isNotEmpty()) {
                    connection.setRequestProperty("Referer", referer)
                }
                
                session.headers["range"]?.let {
                    connection.setRequestProperty("Range", it)
                }

                connection.connect()
                val responseCode = connection.responseCode
                val inputStream: InputStream = if (responseCode in 200..299) connection.inputStream else connection.errorStream
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
    private var multicastLock: android.net.wifi.WifiManager.MulticastLock? = null

    private fun getLocalIpAddress(): String? {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val networkInterface = interfaces.nextElement()
                if (networkInterface.isLoopback || !networkInterface.isUp) continue
                val addresses = networkInterface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    if (!addr.isLoopbackAddress && addr.hostAddress.indexOf(':') < 0) {
                        return addr.hostAddress
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
                    server = LocalVideoProxyServer(port)
                    server?.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
                }
                val ip = getLocalIpAddress() ?: "127.0.0.1"
                promise.resolve(ip)
            } catch (e: Exception) {
                promise.reject("ERR_SERVER_START", "Failed to start server", e)
            }
        }

        AsyncFunction("stopServer") { promise: Promise ->
            try {
                server?.stop()
                server = null
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
