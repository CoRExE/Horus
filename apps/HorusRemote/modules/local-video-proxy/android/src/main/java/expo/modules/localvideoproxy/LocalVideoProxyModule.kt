package expo.modules.localvideoproxy

import android.util.Log
import com.google.android.gms.net.CronetProviderInstaller
import com.google.android.gms.tasks.Tasks
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import fi.iki.elonen.NanoHTTPD
import org.chromium.net.CronetEngine
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.NetworkInterface
import java.net.URLEncoder
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.URLDecoder
import java.security.MessageDigest
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

data class HlsSegment(
    val sequence: Long,
    val url: String
)

data class HlsPlaylistSnapshot(
    val mediaPlaylistUrl: String,
    val segments: List<HlsSegment>,
    val mediaSequence: Long,
    val targetDurationMs: Long,
    val hasEndList: Boolean
)

data class HlsVariant(
    val bandwidth: Long,
    val url: String,
    val codecs: String?,
    val width: Int?,
    val height: Int?,
    val usesExternalAudio: Boolean
)

class HlsSequenceInputStream(
    private val rootPlaylistUrl: String,
    private var snapshot: HlsPlaylistSnapshot,
    private val referer: String?,
    private val origin: String?,
    private val userAgent: String,
    private val server: LocalVideoProxyServer,
    private val strict: Boolean = false
) : InputStream() {
    private var nextSequence = snapshot.mediaSequence
    private var currentStream: InputStream? = null
    private var currentConnection: HttpURLConnection? = null
    @Volatile private var closed = false

    private fun refreshSnapshot(): Boolean {
        try {
            val freshSnapshot = server.fetchHlsSnapshot(
                rootPlaylistUrl,
                referer,
                origin,
                userAgent
            )
            snapshot = freshSnapshot
            return snapshot.segments.any { it.sequence >= nextSequence }
        } catch (e: Exception) {
            Log.w("LocalVideoProxy", "HLS playlist refresh failed: ${e.message}")
            return false
        }
    }

    private fun nextSegment(): HlsSegment? {
        snapshot.segments.firstOrNull { it.sequence >= nextSequence }?.let {
            return it
        }

        if (snapshot.hasEndList) return null

        var refreshAttempts = 0
        while (!closed && refreshAttempts < 12) {
            val waitMs = (snapshot.targetDurationMs / 2).coerceIn(500L, 5_000L)
            Thread.sleep(waitMs)
            if (refreshSnapshot()) {
                snapshot.segments.firstOrNull { it.sequence >= nextSequence }?.let {
                    Log.d("LocalVideoProxy", "HLS window advanced at sequence ${it.sequence}")
                    return it
                }
            }
            if (snapshot.hasEndList) return null
            refreshAttempts++
        }

        Log.w("LocalVideoProxy", "No new HLS segment after $refreshAttempts refresh attempts")
        return null
    }

    private fun nextStream(): Boolean {
        currentStream?.close()
        currentConnection?.disconnect()
        currentStream = null
        currentConnection = null

        while (!closed) {
            val segment = nextSegment() ?: return false
            Log.d("LocalVideoProxy", "[Proxy] Pushing HLS segment sequence ${segment.sequence}")

            for (attempt in 0..2) {
                try {
                    var connection = server.openHttpConnection(
                        segment.url,
                        referer,
                        origin,
                        userAgent
                    )
                    connection.connect()

                    var responseCode = connection.responseCode

                    if (responseCode == 401 || responseCode == 403 || responseCode == 410) {
                        connection.disconnect()
                        refreshSnapshot()
                        val refreshedSegment = snapshot.segments
                            .firstOrNull { it.sequence == segment.sequence }
                        if (refreshedSegment != null) {
                            connection = server.openHttpConnection(
                                refreshedSegment.url,
                                referer,
                                origin,
                                userAgent
                            )
                            connection.connect()
                            responseCode = connection.responseCode
                        }
                    }

                    if (responseCode in 200..299) {
                        currentStream = connection.inputStream
                        currentConnection = connection
                        nextSequence = segment.sequence + 1
                        return true
                    }

                    Log.w(
                        "LocalVideoProxy",
                        "HLS segment ${segment.sequence} attempt ${attempt + 1} " +
                            "returned HTTP $responseCode"
                    )
                    connection.disconnect()
                } catch (e: Exception) {
                    Log.w(
                        "LocalVideoProxy",
                        "HLS segment ${segment.sequence} attempt ${attempt + 1} failed: " +
                            e.message
                    )
                }

                if (attempt < 2 && !closed) {
                    Thread.sleep(500L * (attempt + 1))
                }
            }

            Log.w("LocalVideoProxy", "Skipping HLS segment ${segment.sequence} after retries")
            if (strict) {
                throw IOException("HLS segment ${segment.sequence} failed after retries")
            }
            nextSequence = segment.sequence + 1
        }

        return false
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
        closed = true
        currentStream?.close()
        currentConnection?.disconnect()
        super.close()
    }
}

class LocalVideoProxyServer(
    port: Int,
    private val accessToken: String,
    private val cacheDirectory: File,
    private val cronetEngine: CronetEngine?
) : NanoHTTPD(port) {

    @Volatile
    var lastProxyError: String? = null
        private set

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
        val url = requireHttpUrl(urlString)
        val connection = (cronetEngine?.openConnection(url) ?: url.openConnection())
            as HttpURLConnection
        connection.requestMethod = "GET"
        connection.connectTimeout = 15_000
        connection.readTimeout = 45_000
        connection.setRequestProperty("User-Agent", userAgent)
        connection.setRequestProperty("Accept", "*/*")
        connection.setRequestProperty("Accept-Language", "fr-FR,fr;q=0.9,en;q=0.8")
        referer
            ?.takeIf { it.startsWith("http://") || it.startsWith("https://") }
            ?.let { connection.setRequestProperty("Referer", it) }
        origin
            ?.takeIf { it.startsWith("http://") || it.startsWith("https://") }
            ?.let { connection.setRequestProperty("Origin", it) }
        range?.let { connection.setRequestProperty("Range", it) }
        return connection
    }

    private fun openHlsRelayConnection(
        urlString: String,
        referer: String?,
        origin: String?,
        userAgent: String,
        range: String?
    ): HttpURLConnection {
        var lastResponseCode: Int? = null
        var lastException: Exception? = null

        for (attempt in 0..2) {
            try {
                val connection = openHttpConnection(
                    urlString,
                    referer,
                    origin,
                    userAgent,
                    range
                )
                connection.connect()
                val responseCode = connection.responseCode
                if (responseCode in 200..299) {
                    if (attempt > 0) {
                        Log.i(
                            "LocalVideoProxy",
                            "HLS upstream recovered after ${attempt + 1} attempts"
                        )
                    }
                    return connection
                }

                lastResponseCode = responseCode
                connection.disconnect()
                val isRetryable = responseCode == 401 ||
                    responseCode == 403 ||
                    responseCode == 408 ||
                    responseCode == 425 ||
                    responseCode == 429 ||
                    responseCode in 500..599
                if (!isRetryable) break
            } catch (error: Exception) {
                lastException = error
            }

            if (attempt < 2) {
                Thread.sleep(300L * (attempt + 1))
            }
        }

        lastResponseCode?.let { responseCode ->
            throw IOException("Upstream returned HTTP $responseCode")
        }
        throw IOException(
            lastException?.message ?: "Unable to connect to the HLS upstream"
        )
    }

    private fun localHlsPath(
        upstreamUrl: String,
        referer: String?,
        origin: String?,
        userAgent: String
    ): String {
        fun encoded(value: String): String =
            URLEncoder.encode(value, StandardCharsets.UTF_8.toString())

        val query = mutableListOf(
            "token=${encoded(accessToken)}",
            "url=${encoded(upstreamUrl)}",
            "userAgent=${encoded(userAgent)}"
        )
        referer?.let { query.add("referer=${encoded(it)}") }
        origin?.let { query.add("origin=${encoded(it)}") }
        return "/hls?${query.joinToString("&")}"
    }

    private fun rewriteHlsPlaylist(
        playlist: String,
        playlistUrl: String,
        referer: String?,
        origin: String?,
        userAgent: String
    ): String {
        val uriAttribute = Regex("""URI="([^"]+)"""")
        return playlist.lineSequence().joinToString("\n") { line ->
            val trimmed = line.trim()
            when {
                trimmed.isNotEmpty() && !trimmed.startsWith("#") -> {
                    localHlsPath(
                        resolvePlaylistUri(playlistUrl, trimmed),
                        referer,
                        origin,
                        userAgent
                    )
                }
                trimmed.startsWith("#") && uriAttribute.containsMatchIn(line) -> {
                    uriAttribute.replace(line) { match ->
                        val resolved = resolvePlaylistUri(playlistUrl, match.groupValues[1])
                        "URI=\"${localHlsPath(resolved, referer, origin, userAgent)}\""
                    }
                }
                else -> line
            }
        }
    }

    private fun rememberProxyError(targetUrl: String?, error: String): String {
        val target = try {
            targetUrl?.let { URL(it) }?.let { "${it.host}${it.path}" }
        } catch (_: Exception) {
            null
        }
        val transport = if (cronetEngine != null) "Cronet" else "HttpURLConnection"
        val detail = "$error (transport: $transport)"
        return if (target != null) "$target: $detail" else detail
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

    private fun selectCompatibleVariant(variants: List<HlsVariant>): HlsVariant {
        val codecCompatible = variants.filter { variant ->
            val codecs = variant.codecs?.lowercase().orEmpty()
            codecs.isEmpty() ||
                (("avc1" in codecs || "h264" in codecs) &&
                    !("hev1" in codecs || "hvc1" in codecs || "av01" in codecs))
        }
        val resolutionCompatible = codecCompatible.filter { variant ->
            (variant.width == null || variant.width <= 1920) &&
                (variant.height == null || variant.height <= 1080)
        }
        val muxedCandidates = resolutionCompatible.filterNot { it.usesExternalAudio }
        val candidates = when {
            muxedCandidates.isNotEmpty() -> muxedCandidates
            resolutionCompatible.isNotEmpty() -> resolutionCompatible
            codecCompatible.isNotEmpty() -> codecCompatible
            else -> variants
        }

        return candidates.maxByOrNull { it.bandwidth }
            ?: variants.minByOrNull { it.bandwidth }
            ?: throw IllegalStateException("HLS master playlist has no variant")
    }

    fun cacheFile(id: String, extension: String): File {
        require(Regex("^[a-f0-9]{32}$").matches(id)) { "Invalid cache identifier" }
        cacheDirectory.mkdirs()
        return File(cacheDirectory, "$id.$extension")
    }

    fun removeCachedMedia(id: String) {
        if (!Regex("^[a-f0-9]{32}$").matches(id)) return
        cacheDirectory.listFiles()
            ?.filter { it.name.startsWith("$id.") }
            ?.forEach { it.delete() }
    }

    private fun findCachedMedia(id: String): File? {
        if (!Regex("^[a-f0-9]{32}$").matches(id)) return null
        return cacheDirectory.listFiles()
            ?.firstOrNull {
                it.isFile &&
                    !it.name.endsWith(".part") &&
                    it.name.startsWith("$id.")
            }
    }

    private fun cachedContentType(file: File): String {
        return when (file.extension.lowercase()) {
            "ts" -> "video/mp2t"
            "mkv" -> "video/x-matroska"
            "webm" -> "video/webm"
            else -> "video/mp4"
        }
    }

    private fun serveCachedMedia(session: IHTTPSession): Response {
        val id = session.parameters["id"]?.firstOrNull()
            ?: return newFixedLengthResponse(
                Response.Status.BAD_REQUEST,
                MIME_PLAINTEXT,
                "Missing cache identifier"
            )
        val file = findCachedMedia(id)
            ?: return newFixedLengthResponse(
                Response.Status.NOT_FOUND,
                MIME_PLAINTEXT,
                "Cached media not found"
            )
        val fileLength = file.length()
        if (fileLength <= 0L) {
            return newFixedLengthResponse(
                Response.Status.INTERNAL_ERROR,
                MIME_PLAINTEXT,
                "Cached media is empty"
            )
        }

        var start = 0L
        var end = fileLength - 1
        var isPartial = false
        val rangeHeader = session.headers["range"]
        if (!rangeHeader.isNullOrBlank()) {
            val match = Regex("""bytes=(\d*)-(\d*)""").matchEntire(rangeHeader.trim())
                ?: return newFixedLengthResponse(
                    Response.Status.RANGE_NOT_SATISFIABLE,
                    MIME_PLAINTEXT,
                    "Invalid range"
                )
            val rawStart = match.groupValues[1]
            val rawEnd = match.groupValues[2]
            if (rawStart.isBlank() && rawEnd.isNotBlank()) {
                val suffixLength = rawEnd.toLongOrNull()?.coerceAtMost(fileLength) ?: 0L
                start = (fileLength - suffixLength).coerceAtLeast(0L)
            } else {
                start = rawStart.toLongOrNull() ?: 0L
                end = rawEnd.toLongOrNull()?.coerceAtMost(fileLength - 1) ?: end
            }
            if (start !in 0 until fileLength || end < start) {
                return newFixedLengthResponse(
                    Response.Status.RANGE_NOT_SATISFIABLE,
                    MIME_PLAINTEXT,
                    "Range outside cached media"
                ).apply {
                    addHeader("Content-Range", "bytes */$fileLength")
                }
            }
            isPartial = true
        }

        val length = end - start + 1
        val input = FileInputStream(file)
        input.channel.position(start)
        val status = if (isPartial) Response.Status.PARTIAL_CONTENT else Response.Status.OK
        return newFixedLengthResponse(status, cachedContentType(file), input, length).apply {
            addHeader("Accept-Ranges", "bytes")
            addHeader("Content-Length", length.toString())
            addHeader("transferMode.dlna.org", "Streaming")
            addHeader(
                "contentFeatures.dlna.org",
                "DLNA.ORG_OP=01;DLNA.ORG_CI=" +
                    (if (file.extension.equals("ts", ignoreCase = true)) "1" else "0") +
                    ";DLNA.ORG_FLAGS=01700000000000000000000000000000"
            )
            if (isPartial) {
                addHeader("Content-Range", "bytes $start-$end/$fileLength")
            }
        }
    }

    fun fetchHlsSnapshot(
        playlistUrl: String,
        referer: String?,
        origin: String?,
        userAgent: String,
        depth: Int = 0
    ): HlsPlaylistSnapshot {
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

        require(text.lineSequence().any { it.trim() == "#EXTM3U" }) {
            "Upstream response is not an HLS playlist"
        }

        val segments = mutableListOf<HlsSegment>()
        val variants = mutableListOf<HlsVariant>()
        var pendingVariant: HlsVariant? = null
        var unsupportedEncryption = false
        var usesFragmentedMp4 = false
        var mediaSequence = 0L
        var targetDurationMs = 4_000L
        var hasEndList = false

        text.split("\n").forEach { line ->
            val trimmed = line.trim()
            if (trimmed.startsWith("#EXT-X-STREAM-INF:")) {
                val attributes = trimmed.substringAfter(":")
                val bandwidth = Regex("""(?:^|,)BANDWIDTH=(\d+)""")
                    .find(attributes)
                    ?.groupValues
                    ?.get(1)
                    ?.toLongOrNull()
                    ?: 0L
                val codecs = Regex("""(?:^|,)CODECS="([^"]+)"""")
                    .find(attributes)
                    ?.groupValues
                    ?.get(1)
                val resolution = Regex("""(?:^|,)RESOLUTION=(\d+)x(\d+)""")
                    .find(attributes)
                pendingVariant = HlsVariant(
                    bandwidth = bandwidth,
                    url = "",
                    codecs = codecs,
                    width = resolution?.groupValues?.get(1)?.toIntOrNull(),
                    height = resolution?.groupValues?.get(2)?.toIntOrNull(),
                    usesExternalAudio = Regex("""(?:^|,)AUDIO="[^"]+"""")
                        .containsMatchIn(attributes)
                )
            } else if (trimmed.startsWith("#EXT-X-KEY:") && !trimmed.contains("METHOD=NONE")) {
                unsupportedEncryption = true
            } else if (trimmed.startsWith("#EXT-X-MAP:")) {
                usesFragmentedMp4 = true
            } else if (trimmed.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
                mediaSequence = trimmed.substringAfter(":").trim().toLongOrNull() ?: 0L
            } else if (trimmed.startsWith("#EXT-X-TARGETDURATION:")) {
                val targetDurationSeconds = trimmed.substringAfter(":").trim().toDoubleOrNull()
                if (targetDurationSeconds != null) {
                    targetDurationMs = (targetDurationSeconds * 1_000).toLong()
                }
            } else if (trimmed == "#EXT-X-ENDLIST") {
                hasEndList = true
            } else if (trimmed.isNotBlank() && !trimmed.startsWith("#")) {
                val absoluteUrl = resolvePlaylistUri(playlistUrl, trimmed)
                val variant = pendingVariant
                if (variant != null) {
                    variants.add(variant.copy(url = absoluteUrl))
                    pendingVariant = null
                } else {
                    segments.add(
                        HlsSegment(
                            sequence = mediaSequence + segments.size,
                            url = absoluteUrl
                        )
                    )
                }
            }
        }

        if (variants.isNotEmpty()) {
            val selectedVariant = selectCompatibleVariant(variants)
            Log.d(
                "LocalVideoProxy",
                "Selected HLS variant ${selectedVariant.width ?: "?"}x" +
                    "${selectedVariant.height ?: "?"} @ ${selectedVariant.bandwidth}bps"
            )
            return fetchHlsSnapshot(
                selectedVariant.url,
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

        return HlsPlaylistSnapshot(
            mediaPlaylistUrl = playlistUrl,
            segments = segments,
            mediaSequence = mediaSequence,
            targetDurationMs = targetDurationMs.coerceIn(1_000L, 30_000L),
            hasEndList = hasEndList
        )
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

        if (session.uri == "/cache") {
            return serveCachedMedia(session)
        } else if (session.uri == "/hls") {
            if (targetUrlStr == null) {
                return newFixedLengthResponse(
                    Response.Status.BAD_REQUEST,
                    MIME_PLAINTEXT,
                    "Missing URL"
                )
            }

            try {
                val connection = openHlsRelayConnection(
                    targetUrlStr,
                    referer,
                    origin,
                    userAgent,
                    session.headers["range"]
                )
                val responseCode = connection.responseCode

                val upstreamContentType = connection.contentType
                    ?.substringBefore(";")
                    ?.trim()
                    .orEmpty()
                val isPlaylist = URL(targetUrlStr).path.endsWith(".m3u8", ignoreCase = true) ||
                    upstreamContentType.contains("mpegurl", ignoreCase = true)

                if (isPlaylist) {
                    val playlist = connection.inputStream.bufferedReader().use { it.readText() }
                    connection.disconnect()
                    require(playlist.lineSequence().any { it.trim() == "#EXTM3U" }) {
                        "Upstream response is not an HLS playlist"
                    }
                    val rewritten = rewriteHlsPlaylist(
                        playlist,
                        targetUrlStr,
                        referer,
                        origin,
                        userAgent
                    )
                    return newFixedLengthResponse(
                        Response.Status.OK,
                        "application/vnd.apple.mpegurl",
                        rewritten
                    ).apply {
                        addHeader("Access-Control-Allow-Origin", "*")
                        addHeader("Cache-Control", "no-store")
                    }
                }

                val input = connection.inputStream
                val contentType = upstreamContentType.ifBlank { "application/octet-stream" }
                val contentLength = connection.contentLengthLong
                val status = if (responseCode == 206) {
                    Response.Status.PARTIAL_CONTENT
                } else {
                    Response.Status.OK
                }
                val response = if (contentLength >= 0) {
                    newFixedLengthResponse(status, contentType, input, contentLength)
                } else {
                    newChunkedResponse(status, contentType, input)
                }
                connection.getHeaderField("Content-Range")
                    ?.let { response.addHeader("Content-Range", it) }
                connection.getHeaderField("Accept-Ranges")
                    ?.let { response.addHeader("Accept-Ranges", it) }
                response.addHeader("Access-Control-Allow-Origin", "*")
                return response
            } catch (error: Exception) {
                val message = error.message ?: error.javaClass.simpleName
                lastProxyError = rememberProxyError(targetUrlStr, message)
                Log.e("LocalVideoProxy", "HLS relay error", error)
                return newFixedLengthResponse(
                    Response.Status.INTERNAL_ERROR,
                    MIME_PLAINTEXT,
                    message
                )
            }
        } else if (session.uri == "/stream.ts") {
            if (targetUrlStr == null) return newFixedLengthResponse(Response.Status.BAD_REQUEST, MIME_PLAINTEXT, "Missing URL")

            try {
                Log.d("LocalVideoProxy", "Starting authenticated HLS proxy")
                val snapshot = fetchHlsSnapshot(targetUrlStr, referer, origin, userAgent)
                if (snapshot.segments.isEmpty()) {
                    return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, "No segments found")
                }

                Log.d(
                    "LocalVideoProxy",
                    "Found ${snapshot.segments.size} HLS segments " +
                        "(endList=${snapshot.hasEndList}). Starting MPEG-TS stitching."
                )
                val sequenceStream = HlsSequenceInputStream(
                    targetUrlStr,
                    snapshot,
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
                lastProxyError = rememberProxyError(
                    targetUrlStr,
                    e.message ?: e.javaClass.simpleName
                )
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
    @Volatile private var server: LocalVideoProxyServer? = null
    @Volatile private var accessToken: String? = null
    @Volatile private var cronetEngine: CronetEngine? = null
    private var multicastLock: android.net.wifi.WifiManager.MulticastLock? = null
    private var wakeLock: android.os.PowerManager.WakeLock? = null
    private var wifiLock: android.net.wifi.WifiManager.WifiLock? = null
    private val cacheCancelled = AtomicBoolean(false)
    @Volatile private var cacheThread: Thread? = null
    @Volatile private var activeCacheResource: Closeable? = null
    @Volatile private var activeCacheConnection: HttpURLConnection? = null

    @Synchronized
    private fun getOrCreateCronetEngine(): CronetEngine {
        cronetEngine?.let { return it }
        val context = appContext.reactContext?.applicationContext
            ?: throw IllegalStateException("ReactContext unavailable")
        Tasks.await(
            CronetProviderInstaller.installProvider(context),
            20,
            TimeUnit.SECONDS
        )
        return CronetEngine.Builder(context)
            .enableHttpCache(CronetEngine.Builder.HTTP_CACHE_DISABLED, 0)
            .build()
            .also {
                cronetEngine = it
                Log.i("LocalVideoProxy", "Chromium Cronet transport initialized")
            }
    }

    private fun getCacheDirectory(): File {
        val context = appContext.reactContext
            ?: throw IllegalStateException("ReactContext unavailable")
        return File(context.cacheDir, "horus_media_cache").apply { mkdirs() }
    }

    private fun clearCacheDirectory() {
        val directory = getCacheDirectory()
        directory.listFiles()?.forEach { file ->
            if (file.isDirectory) {
                file.deleteRecursively()
            } else {
                file.delete()
            }
        }
    }

    private fun cachedExtension(contentType: String, isHls: Boolean): String {
        if (isHls) return "ts"
        return when {
            contentType.contains("matroska", ignoreCase = true) -> "mkv"
            contentType.contains("webm", ignoreCase = true) -> "webm"
            contentType.contains("mp2t", ignoreCase = true) -> "ts"
            else -> "mp4"
        }
    }

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
        Events("onCacheProgress")

        AsyncFunction("startServer") { port: Int, promise: Promise ->
            Thread {
                try {
                    synchronized(this@LocalVideoProxyModule) {
                        if (server == null) {
                            val transport = try {
                                getOrCreateCronetEngine()
                            } catch (error: Exception) {
                                Log.e(
                                    "LocalVideoProxy",
                                    "Cronet unavailable; using the system HTTP transport",
                                    error
                                )
                                null
                            }
                            accessToken = UUID.randomUUID().toString().replace("-", "")
                            server = LocalVideoProxyServer(
                                port,
                                accessToken!!,
                                getCacheDirectory(),
                                transport
                            )
                            server?.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
                            acquireLocks()
                        }
                    }
                    val ip = getLocalIpAddress() ?: "127.0.0.1"
                    promise.resolve(mapOf(
                        "ip" to ip,
                        "token" to accessToken
                    ))
                } catch (e: Exception) {
                    promise.reject("ERR_SERVER_START", "Failed to start server", e)
                }
            }.start()
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

        AsyncFunction("getLastError") { promise: Promise ->
            promise.resolve(server?.lastProxyError)
        }

        AsyncFunction("cacheMedia") {
            url: String,
            format: String,
            referer: String?,
            origin: String?,
            requestedUserAgent: String?,
            promise: Promise ->
            synchronized(this@LocalVideoProxyModule) {
                if (cacheThread?.isAlive == true) {
                    promise.reject(
                        "ERR_CACHE_BUSY",
                        "Another media download is already running",
                        null
                    )
                    return@AsyncFunction
                }

                val activeServer = server
                if (activeServer == null) {
                    promise.reject(
                        "ERR_SERVER_NOT_STARTED",
                        "Local video server must be started before caching",
                        null
                    )
                    return@AsyncFunction
                }

                cacheCancelled.set(false)
                val cacheId = UUID.randomUUID().toString().replace("-", "")
                val userAgent = requestedUserAgent
                    ?.takeIf { it.length in 1..512 }
                    ?: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

                cacheThread = Thread {
                    val cacheDirectory = getCacheDirectory()
                    val partialFile = File(cacheDirectory, "$cacheId.part")
                    var finalFile: File? = null
                    var connection: HttpURLConnection? = null
                    var input: InputStream? = null
                    try {
                        val isHls = format.equals("hls", ignoreCase = true)
                        var contentType = if (isHls) "video/mp2t" else "video/mp4"
                        var totalBytes = -1L

                        if (isHls) {
                            val snapshot = activeServer.fetchHlsSnapshot(
                                url,
                                referer,
                                origin,
                                userAgent
                            )
                            input = HlsSequenceInputStream(
                                url,
                                snapshot,
                                referer,
                                origin,
                                userAgent,
                                activeServer,
                                strict = true
                            )
                        } else {
                            connection = activeServer.openHttpConnection(
                                url,
                                referer,
                                origin,
                                userAgent
                            )
                            activeCacheConnection = connection
                            connection.connect()
                            val responseCode = connection.responseCode
                            if (responseCode !in 200..299) {
                                throw IOException("Upstream returned HTTP $responseCode")
                            }
                            contentType = connection.contentType
                                ?.substringBefore(";")
                                ?.trim()
                                ?.takeIf { it.isNotBlank() }
                                ?: "video/mp4"
                            totalBytes = connection.contentLengthLong
                            if (
                                totalBytes > 0 &&
                                totalBytes + 100L * 1024L * 1024L > cacheDirectory.usableSpace
                            ) {
                                throw IOException("Not enough free space for cached media")
                            }
                            input = connection.inputStream
                        }

                        activeCacheResource = input
                        var downloadedBytes = 0L
                        var lastProgressAt = 0L
                        val buffer = ByteArray(256 * 1024)
                        FileOutputStream(partialFile).use { output ->
                            while (true) {
                                if (cacheCancelled.get()) {
                                    throw IOException("Media download cancelled")
                                }
                                val read = input.read(buffer)
                                if (read < 0) break
                                output.write(buffer, 0, read)
                                downloadedBytes += read

                                if (cacheDirectory.usableSpace < 64L * 1024L * 1024L) {
                                    throw IOException("Not enough free space to finish cached media")
                                }

                                val now = System.currentTimeMillis()
                                if (now - lastProgressAt >= 250L) {
                                    sendEvent(
                                        "onCacheProgress",
                                        mapOf(
                                            "bytesDownloaded" to downloadedBytes.toDouble(),
                                            "totalBytes" to totalBytes
                                                .takeIf { it > 0 }
                                                ?.toDouble()
                                        )
                                    )
                                    lastProgressAt = now
                                }
                            }
                            output.fd.sync()
                        }

                        if (cacheCancelled.get()) {
                            throw IOException("Media download cancelled")
                        }
                        if (downloadedBytes <= 0L) {
                            throw IOException("Downloaded media is empty")
                        }

                        val extension = cachedExtension(contentType, isHls)
                        finalFile = activeServer.cacheFile(cacheId, extension)
                        if (!partialFile.renameTo(finalFile)) {
                            throw IOException("Could not finalize cached media")
                        }
                        sendEvent(
                            "onCacheProgress",
                            mapOf(
                                "bytesDownloaded" to downloadedBytes.toDouble(),
                                "totalBytes" to downloadedBytes.toDouble()
                            )
                        )
                        promise.resolve(
                            mapOf(
                                "id" to cacheId,
                                "contentType" to contentType,
                                "sizeBytes" to downloadedBytes.toDouble()
                            )
                        )
                    } catch (error: Exception) {
                        partialFile.delete()
                        finalFile?.delete()
                        val code = if (cacheCancelled.get()) {
                            "ERR_CACHE_CANCELLED"
                        } else {
                            "ERR_CACHE_DOWNLOAD"
                        }
                        promise.reject(code, error.message ?: "Media download failed", error)
                    } finally {
                        try {
                            input?.close()
                        } catch (_: Exception) {
                        }
                        connection?.disconnect()
                        activeCacheResource = null
                        activeCacheConnection = null
                        cacheThread = null
                    }
                }.apply {
                    name = "HorusMediaCache"
                    start()
                }
            }
        }

        AsyncFunction("cancelCache") { promise: Promise ->
            cacheCancelled.set(true)
            try {
                activeCacheResource?.close()
            } catch (_: Exception) {
            }
            activeCacheConnection?.disconnect()
            cacheThread?.interrupt()
            promise.resolve(null)
        }

        AsyncFunction("removeCachedMedia") { id: String, promise: Promise ->
            server?.removeCachedMedia(id)
                ?: run {
                    if (Regex("^[a-f0-9]{32}$").matches(id)) {
                        getCacheDirectory().listFiles()
                            ?.filter { it.name.startsWith("$id.") }
                            ?.forEach { it.delete() }
                    }
                }
            promise.resolve(null)
        }

        AsyncFunction("clearCache") { promise: Promise ->
            if (cacheThread?.isAlive == true) {
                promise.reject(
                    "ERR_CACHE_BUSY",
                    "Cannot clear cache while a download is running",
                    null
                )
                return@AsyncFunction
            }
            clearCacheDirectory()
            promise.resolve(null)
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
