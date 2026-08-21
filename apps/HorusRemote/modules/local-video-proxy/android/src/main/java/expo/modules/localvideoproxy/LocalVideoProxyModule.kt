package expo.modules.localvideoproxy

import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.Composition
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
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
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.net.URLDecoder
import java.security.MessageDigest
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.ArrayDeque
import java.util.Collections
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

data class HlsSegment(
    val sequence: Long,
    val url: String,
    val durationUs: Long = 0L
)

data class HlsPlaylistSnapshot(
    val mediaPlaylistUrl: String,
    val segments: List<HlsSegment>,
    val mediaSequence: Long,
    val targetDurationMs: Long,
    val hasEndList: Boolean,
    val selectedBandwidth: Long? = null,
    val selectedWidth: Int? = null,
    val selectedHeight: Int? = null
)

data class HlsVariant(
    val bandwidth: Long,
    val url: String,
    val codecs: String?,
    val width: Int?,
    val height: Int?,
    val usesExternalAudio: Boolean
)

class ManagedHttpInputStream(
    input: InputStream,
    private val connection: HttpURLConnection,
    private val onReadError: (IOException) -> Unit
) : FilterInputStream(input) {
    private val isClosed = AtomicBoolean(false)
    private val didReportError = AtomicBoolean(false)

    private fun report(error: IOException) {
        if (didReportError.compareAndSet(false, true)) {
            onReadError(error)
        }
    }

    override fun read(): Int {
        return try {
            super.read()
        } catch (error: IOException) {
            report(error)
            throw error
        }
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        return try {
            super.read(buffer, offset, length)
        } catch (error: IOException) {
            report(error)
            throw error
        }
    }

    override fun close() {
        if (!isClosed.compareAndSet(false, true)) return
        try {
            super.close()
        } finally {
            connection.disconnect()
        }
    }
}

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
    private var currentSegment: HlsSegment? = null
    private var currentSegmentBytesRead = 0L
    private var currentSegmentReadRetries = 0
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

    private fun closeCurrentConnection() {
        try {
            currentStream?.close()
        } catch (error: IOException) {
            Log.d("LocalVideoProxy", "Ignoring HLS segment close error: ${error.message}")
        } finally {
            currentConnection?.disconnect()
            currentStream = null
            currentConnection = null
        }
    }

    private fun nextStream(): Boolean {
        closeCurrentConnection()
        currentSegment = null
        currentSegmentBytesRead = 0L
        currentSegmentReadRetries = 0

        while (!closed) {
            val segment = nextSegment() ?: return false
            Log.d("LocalVideoProxy", "[Proxy] Pushing HLS segment sequence ${segment.sequence}")

            for (attempt in 0..2) {
                var connection: HttpURLConnection? = null
                try {
                    var connectedSegment = segment
                    connection = server.openHttpConnection(
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
                            connectedSegment = refreshedSegment
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
                        currentSegment = connectedSegment
                        currentSegmentBytesRead = 0L
                        currentSegmentReadRetries = 0
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
                    connection?.disconnect()
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
            server.recordProxyError(
                segment.url,
                "HLS segment ${segment.sequence} failed before transfer"
            )
            if (strict) {
                throw IOException("HLS segment ${segment.sequence} failed after retries")
            }
            nextSequence = segment.sequence + 1
        }

        return false
    }

    private fun recoverCurrentSegment(readError: IOException): Boolean {
        if (closed) return false
        val failedSegment = currentSegment ?: return nextStream()
        server.recordProxyError(
            failedSegment.url,
            "HLS segment ${failedSegment.sequence} transfer interrupted: " +
                (readError.message ?: readError.javaClass.simpleName)
        )
        Log.w(
            "LocalVideoProxy",
            "HLS segment ${failedSegment.sequence} transfer interrupted after " +
                "$currentSegmentBytesRead bytes",
            readError
        )

        closeCurrentConnection()

        var resumeSegment = failedSegment
        while (!closed && currentSegmentReadRetries < 2) {
            currentSegmentReadRetries++
            var connection: HttpURLConnection? = null
            try {
                val range = if (currentSegmentBytesRead > 0L) {
                    "bytes=$currentSegmentBytesRead-"
                } else {
                    null
                }
                connection = server.openHttpConnection(
                    resumeSegment.url,
                    referer,
                    origin,
                    userAgent,
                    range
                )
                connection.connect()
                var responseCode = connection.responseCode
                if (responseCode == 401 || responseCode == 403 || responseCode == 410) {
                    connection.disconnect()
                    refreshSnapshot()
                    snapshot.segments
                        .firstOrNull { it.sequence == failedSegment.sequence }
                        ?.let { refreshedSegment ->
                            resumeSegment = refreshedSegment
                            currentSegment = refreshedSegment
                            connection = server.openHttpConnection(
                                refreshedSegment.url,
                                referer,
                                origin,
                                userAgent,
                                range
                            )
                            connection.connect()
                            responseCode = connection.responseCode
                        }
                }
                val resumedConnection = connection
                    ?: throw IOException("HLS resume connection unavailable")
                val canResume = responseCode in 200..299 &&
                    (currentSegmentBytesRead == 0L || responseCode == 206)
                if (canResume) {
                    currentStream = resumedConnection.inputStream
                    currentConnection = resumedConnection
                    Log.i(
                        "LocalVideoProxy",
                        "Resumed HLS segment ${failedSegment.sequence} at byte " +
                            "$currentSegmentBytesRead on attempt $currentSegmentReadRetries"
                    )
                    return true
                }
                Log.w(
                    "LocalVideoProxy",
                    "Unable to resume HLS segment ${failedSegment.sequence}: HTTP $responseCode"
                )
                resumedConnection.disconnect()
            } catch (error: Exception) {
                connection?.disconnect()
                Log.w(
                    "LocalVideoProxy",
                    "HLS segment ${failedSegment.sequence} resume attempt " +
                        "$currentSegmentReadRetries failed: ${error.message}"
                )
            }

            if (currentSegmentReadRetries < 2 && !closed) {
                Thread.sleep(500L * currentSegmentReadRetries)
            }
        }

        if (strict) {
            throw IOException(
                "HLS segment ${failedSegment.sequence} transfer failed after retries",
                readError
            )
        }

        Log.w(
            "LocalVideoProxy",
            "Skipping the remainder of HLS segment ${failedSegment.sequence} to keep TV playback alive"
        )
        return nextStream()
    }

    override fun read(): Int {
        while (!closed) {
            if (currentStream == null && !nextStream()) return -1
            try {
                val value = currentStream?.read() ?: -1
                if (value >= 0) {
                    currentSegmentBytesRead++
                    return value
                }
                if (!nextStream()) return -1
            } catch (error: IOException) {
                if (!recoverCurrentSegment(error)) return -1
            }
        }
        return -1
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
        if (len == 0) return 0
        while (!closed) {
            if (currentStream == null && !nextStream()) return -1
            try {
                val bytesRead = currentStream?.read(b, off, len) ?: -1
                if (bytesRead >= 0) {
                    currentSegmentBytesRead += bytesRead
                    return bytesRead
                }
                if (!nextStream()) return -1
            } catch (error: IOException) {
                if (!recoverCurrentSegment(error)) return -1
            }
        }
        return -1
    }

    override fun close() {
        closed = true
        closeCurrentConnection()
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

    fun recordProxyError(targetUrl: String?, error: String) {
        lastProxyError = rememberProxyError(targetUrl, error)
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

    private fun selectCompatibleVariant(
        variants: List<HlsVariant>,
        maxHeight: Int
    ): HlsVariant {
        val codecCompatible = variants.filter { variant ->
            val codecs = variant.codecs?.lowercase().orEmpty()
            codecs.isEmpty() ||
                (("avc1" in codecs || "h264" in codecs) &&
                    !("hev1" in codecs || "hvc1" in codecs || "av01" in codecs))
        }
        val resolutionCompatible = codecCompatible.filter { variant ->
            (variant.width == null || variant.width <= 1920) &&
                (variant.height == null || variant.height <= maxHeight)
        }
        val muxedCandidates = resolutionCompatible.filterNot { it.usesExternalAudio }
        val candidates = when {
            muxedCandidates.isNotEmpty() -> muxedCandidates
            resolutionCompatible.isNotEmpty() -> resolutionCompatible
            codecCompatible.isNotEmpty() -> listOf(
                codecCompatible.minByOrNull { it.bandwidth } ?: codecCompatible.first()
            )
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
        depth: Int = 0,
        maxHeight: Int = 1080,
        selectedVariant: HlsVariant? = null
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
        var pendingDurationUs = 0L

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
            } else if (trimmed.startsWith("#EXTINF:")) {
                pendingDurationUs = (
                    trimmed.substringAfter(":").substringBefore(",").toDoubleOrNull()
                        ?: 0.0
                ).times(1_000_000.0).toLong()
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
                            url = absoluteUrl,
                            durationUs = pendingDurationUs
                        )
                    )
                    pendingDurationUs = 0L
                }
            }
        }

        if (variants.isNotEmpty()) {
            val selectedVariant = selectCompatibleVariant(variants, maxHeight)
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
                depth + 1,
                maxHeight,
                selectedVariant
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
            hasEndList = hasEndList,
            selectedBandwidth = selectedVariant?.bandwidth?.takeIf { it > 0 },
            selectedWidth = selectedVariant?.width,
            selectedHeight = selectedVariant?.height
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

                val input = ManagedHttpInputStream(
                    connection.inputStream,
                    connection
                ) { error ->
                    lastProxyError = rememberProxyError(
                        targetUrlStr,
                        "Upstream transfer failed: ${error.message ?: error.javaClass.simpleName}"
                    )
                    Log.e("LocalVideoProxy", "HLS upstream transfer failed", error)
                }
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
                val inputStream: InputStream = ManagedHttpInputStream(
                    connection.inputStream,
                    connection
                ) { error ->
                    lastProxyError = rememberProxyError(
                        targetUrlStr,
                        "Upstream transfer failed: ${error.message ?: error.javaClass.simpleName}"
                    )
                    Log.e("LocalVideoProxy", "Media upstream transfer failed", error)
                }
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
    private val cacheCancelled = AtomicBoolean(false)
    @Volatile private var cacheThread: Thread? = null
    @Volatile private var activeCacheResource: Closeable? = null
    @Volatile private var activeCacheConnection: HttpURLConnection? = null
    @Volatile private var activeCacheExecutor: ExecutorService? = null
    @Volatile private var activeTransformer: Transformer? = null
    private val activeCacheConnections = Collections.synchronizedSet(
        mutableSetOf<HttpURLConnection>()
    )

    private fun hasMp4CompatibleTracks(inputFile: File): Boolean {
        val extractor = MediaExtractor()
        return try {
            extractor.setDataSource(inputFile.absolutePath)
            var hasVideo = false
            var hasAudio = false
            for (index in 0 until extractor.trackCount) {
                val mime = extractor.getTrackFormat(index)
                    .getString(MediaFormat.KEY_MIME)
                    .orEmpty()
                when {
                    mime.startsWith("video/") -> {
                        if (mime != MediaFormat.MIMETYPE_VIDEO_AVC) return false
                        hasVideo = true
                    }
                    mime.startsWith("audio/") -> {
                        if (mime != MediaFormat.MIMETYPE_AUDIO_AAC) return false
                        hasAudio = true
                    }
                }
            }
            hasVideo && hasAudio
        } catch (error: Exception) {
            Log.w("LocalVideoProxy", "Unable to inspect cached TS tracks", error)
            false
        } finally {
            extractor.release()
        }
    }

    @androidx.annotation.OptIn(UnstableApi::class)
    private fun remuxTsToMp4(
        context: android.content.Context,
        inputFile: File,
        outputFile: File,
        downloadedBytes: Long
    ): Boolean {
        if (!hasMp4CompatibleTracks(inputFile)) {
            Log.w("LocalVideoProxy", "Cached TS is not H.264/AAC; keeping MPEG-TS fallback")
            return false
        }
        if (cacheDirectoryUsableSpace(inputFile.parentFile) < inputFile.length() + 64L * 1024L * 1024L) {
            Log.w("LocalVideoProxy", "Not enough free space to remux cached TS to MP4")
            return false
        }

        outputFile.delete()
        val mainHandler = Handler(Looper.getMainLooper())
        val completion = CountDownLatch(1)
        var succeeded = false
        var exportError: Throwable? = null
        mainHandler.post {
            if (cacheCancelled.get()) {
                completion.countDown()
                return@post
            }
            try {
                val transformer = Transformer.Builder(context)
                    .addListener(object : Transformer.Listener {
                        override fun onCompleted(
                            composition: Composition,
                            exportResult: ExportResult
                        ) {
                            succeeded = true
                            activeTransformer = null
                            completion.countDown()
                        }

                        override fun onError(
                            composition: Composition,
                            exportResult: ExportResult,
                            exportException: ExportException
                        ) {
                            exportError = exportException
                            activeTransformer = null
                            completion.countDown()
                        }
                    })
                    .build()
                activeTransformer = transformer
                val mediaItem = MediaItem.Builder()
                    .setUri(Uri.fromFile(inputFile))
                    .setMimeType(MimeTypes.VIDEO_MP2T)
                    .build()
                transformer.start(mediaItem, outputFile.absolutePath)
            } catch (error: Throwable) {
                exportError = error
                activeTransformer = null
                completion.countDown()
            }
        }

        while (!completion.await(250L, TimeUnit.MILLISECONDS)) {
            if (cacheCancelled.get()) {
                mainHandler.post {
                    activeTransformer?.cancel()
                    activeTransformer = null
                    completion.countDown()
                }
                completion.await(5L, TimeUnit.SECONDS)
                throw IOException("Media download cancelled")
            }
            mainHandler.post {
                val transformer = activeTransformer ?: return@post
                val holder = ProgressHolder()
                val state = transformer.getProgress(holder)
                val progress = if (state == Transformer.PROGRESS_STATE_AVAILABLE) {
                    holder.progress.coerceIn(0, 100) / 100.0
                } else {
                    0.0
                }
                sendEvent(
                    "onCacheProgress",
                    mapOf(
                        "bytesDownloaded" to downloadedBytes.toDouble(),
                        "totalBytes" to downloadedBytes.toDouble(),
                        "phase" to "optimizing",
                        "phaseProgress" to progress
                    )
                )
            }
        }

        if (!succeeded) {
            outputFile.delete()
            exportError?.let {
                Log.w("LocalVideoProxy", "MP4 remux failed; keeping MPEG-TS fallback", it)
            }
            return false
        }
        sendEvent(
            "onCacheProgress",
            mapOf(
                "bytesDownloaded" to downloadedBytes.toDouble(),
                "totalBytes" to downloadedBytes.toDouble(),
                "phase" to "optimizing",
                "phaseProgress" to 1.0
            )
        )
        return outputFile.isFile && outputFile.length() > 0L
    }

    private fun cacheDirectoryUsableSpace(directory: File?): Long =
        directory?.usableSpace ?: 0L

    private fun estimatedHlsSize(snapshot: HlsPlaylistSnapshot): Long? {
        val bandwidth = snapshot.selectedBandwidth ?: return null
        val durationUs = snapshot.segments.sumOf { it.durationUs }
        if (bandwidth <= 0L || durationUs <= 0L) return null
        return (bandwidth.toDouble() * durationUs.toDouble() / 8_000_000.0)
            .toLong()
            .takeIf { it > 0L }
    }

    private fun downloadHlsSegmentToFile(
        server: LocalVideoProxyServer,
        segment: HlsSegment,
        referer: String?,
        origin: String?,
        userAgent: String,
        destination: File
    ): File {
        var lastError: Exception? = null
        for (attempt in 0..2) {
            if (cacheCancelled.get() || Thread.currentThread().isInterrupted) {
                throw IOException("Media download cancelled")
            }
            var connection: HttpURLConnection? = null
            try {
                connection = server.openHttpConnection(
                    segment.url,
                    referer,
                    origin,
                    userAgent
                )
                activeCacheConnections.add(connection)
                connection.connect()
                val responseCode = connection.responseCode
                if (responseCode !in 200..299) {
                    throw IOException(
                        "HLS segment ${segment.sequence} returned HTTP $responseCode"
                    )
                }
                destination.delete()
                FileOutputStream(destination).use { output ->
                    connection.inputStream.use { input ->
                        val buffer = ByteArray(128 * 1024)
                        while (true) {
                            if (cacheCancelled.get() || Thread.currentThread().isInterrupted) {
                                throw IOException("Media download cancelled")
                            }
                            val read = input.read(buffer)
                            if (read < 0) break
                            output.write(buffer, 0, read)
                            if ((destination.parentFile?.usableSpace ?: 0L) < 64L * 1024L * 1024L) {
                                throw IOException("Not enough free space to finish cached media")
                            }
                        }
                        output.fd.sync()
                    }
                }
                return destination
            } catch (error: Exception) {
                destination.delete()
                lastError = error
                if (attempt < 2 && !cacheCancelled.get()) {
                    Thread.sleep(400L * (attempt + 1))
                }
            } finally {
                connection?.let { activeCacheConnections.remove(it) }
                connection?.disconnect()
            }
        }
        throw IOException(
            lastError?.message ?: "HLS segment ${segment.sequence} failed after retries",
            lastError
        )
    }

    private fun cacheHlsInParallel(
        server: LocalVideoProxyServer,
        snapshot: HlsPlaylistSnapshot,
        referer: String?,
        origin: String?,
        userAgent: String,
        destination: File,
        cacheDirectory: File
    ): Long {
        require(snapshot.hasEndList) {
            "Only complete HLS media can be downloaded for TV cache"
        }
        require(snapshot.segments.isNotEmpty()) { "HLS media has no segments" }

        val estimatedBytes = estimatedHlsSize(snapshot)
        sendEvent(
            "onCacheProgress",
            mutableMapOf<String, Any>(
                "bytesDownloaded" to 0.0,
                "phase" to "downloading"
            ).apply {
                estimatedBytes?.let {
                    put("totalBytes", it.toDouble())
                    put("totalBytesEstimated", true)
                }
            }
        )

        val segmentDirectory = File(cacheDirectory, "${destination.name}.segments")
        segmentDirectory.listFiles()?.forEach { it.delete() }
        require(
            segmentDirectory.isDirectory ||
                (!segmentDirectory.exists() && segmentDirectory.mkdir())
        ) {
            "Could not create temporary HLS segment directory"
        }
        val executor = Executors.newFixedThreadPool(4) { runnable ->
            Thread(runnable, "HorusHlsCacheSegment")
        }
        activeCacheExecutor = executor
        val pending = ArrayDeque<Future<File>>()
        var nextToSchedule = 0
        var downloadedBytes = 0L
        var lastProgressAt = 0L

        fun scheduleNext() {
            if (nextToSchedule >= snapshot.segments.size) return
            val index = nextToSchedule
            val segment = snapshot.segments[nextToSchedule++]
            val segmentFile = File(segmentDirectory, "$index.part")
            pending.addLast(executor.submit<File> {
                downloadHlsSegmentToFile(
                    server,
                    segment,
                    referer,
                    origin,
                    userAgent,
                    segmentFile
                )
            })
        }

        try {
            repeat(minOf(4, snapshot.segments.size)) { scheduleNext() }
            FileOutputStream(destination).use { output ->
                while (pending.isNotEmpty()) {
                    if (cacheCancelled.get()) throw IOException("Media download cancelled")
                    val segmentFile = try {
                        pending.removeFirst().get()
                    } catch (error: Exception) {
                        val cause = error.cause
                        throw IOException(
                            cause?.message ?: error.message ?: "HLS segment download failed",
                            cause ?: error
                        )
                    }
                    FileInputStream(segmentFile).use { input ->
                        input.copyTo(output, 128 * 1024)
                    }
                    downloadedBytes += segmentFile.length()
                    segmentFile.delete()
                    scheduleNext()

                    if (cacheDirectory.usableSpace < 64L * 1024L * 1024L) {
                        throw IOException("Not enough free space to finish cached media")
                    }
                    val now = System.currentTimeMillis()
                    if (now - lastProgressAt >= 200L) {
                        sendEvent(
                            "onCacheProgress",
                            mutableMapOf<String, Any>(
                                "bytesDownloaded" to downloadedBytes.toDouble(),
                                "phase" to "downloading"
                            ).apply {
                                estimatedBytes?.let {
                                    put("totalBytes", maxOf(it, downloadedBytes).toDouble())
                                    put("totalBytesEstimated", true)
                                }
                            }
                        )
                        lastProgressAt = now
                    }
                }
                output.fd.sync()
            }
            return downloadedBytes
        } finally {
            pending.forEach { it.cancel(true) }
            executor.shutdownNow()
            activeCacheExecutor = null
            segmentDirectory.listFiles()?.forEach { it.delete() }
            segmentDirectory.delete()
        }
    }

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
        Events("onCacheProgress", "onMediaControl")

        OnCreate {
            StreamingForegroundService.setMediaControlHandler { action, positionSeconds ->
                sendEvent(
                    "onMediaControl",
                    mutableMapOf<String, Any>("action" to action).apply {
                        positionSeconds?.let { put("positionSeconds", it) }
                    }
                )
            }
        }

        OnDestroy {
            StreamingForegroundService.setMediaControlHandler(null)
        }

        AsyncFunction("setTvNotificationMode") {
            mode: String,
            title: String?,
            imageUrl: String?,
            canSeek: Boolean,
            promise: Promise ->
            try {
                val context = appContext.reactContext?.applicationContext
                    ?: throw IllegalStateException("ReactContext unavailable")
                val normalizedMode = when (mode) {
                    StreamingForegroundService.MODE_PREPARING -> mode
                    StreamingForegroundService.MODE_PLAYER -> mode
                    else -> StreamingForegroundService.MODE_DIRECT
                }
                StreamingForegroundService.setNotificationMode(
                    context,
                    normalizedMode,
                    title,
                    imageUrl,
                    canSeek
                )
                promise.resolve(null)
            } catch (error: Exception) {
                promise.reject(
                    "ERR_NOTIFICATION_UPDATE",
                    "Unable to update TV notification",
                    error
                )
            }
        }

        AsyncFunction("updateTvPlaybackState") {
            isPlaying: Boolean,
            positionSeconds: Double,
            durationSeconds: Double,
            promise: Promise ->
            try {
                val context = appContext.reactContext?.applicationContext
                    ?: throw IllegalStateException("ReactContext unavailable")
                StreamingForegroundService.updatePlayback(
                    context,
                    isPlaying,
                    positionSeconds.coerceAtLeast(0.0),
                    durationSeconds.coerceAtLeast(0.0)
                )
                promise.resolve(null)
            } catch (error: Exception) {
                promise.reject(
                    "ERR_NOTIFICATION_UPDATE",
                    "Unable to update TV playback state",
                    error
                )
            }
        }

        AsyncFunction("updateTvCacheProgress") {
            progress: Double,
            phase: String,
            promise: Promise ->
            try {
                val context = appContext.reactContext?.applicationContext
                    ?: throw IllegalStateException("ReactContext unavailable")
                StreamingForegroundService.updateCacheProgress(
                    context,
                    progress.coerceIn(-1.0, 1.0),
                    if (phase == "optimizing") "optimizing" else "downloading"
                )
                promise.resolve(null)
            } catch (error: Exception) {
                promise.reject(
                    "ERR_NOTIFICATION_UPDATE",
                    "Unable to update TV cache progress",
                    error
                )
            }
        }

        AsyncFunction("startServer") { port: Int, promise: Promise ->
            Thread {
                try {
                    val context = appContext.reactContext?.applicationContext
                        ?: throw IllegalStateException("ReactContext unavailable")
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
                        }
                    }
                    // Republie la notification si l'autorisation vient d'être accordée
                    // alors que le serveur local fonctionnait déjà.
                    StreamingForegroundService.start(context)
                    val ip = getLocalIpAddress() ?: "127.0.0.1"
                    promise.resolve(mapOf(
                        "ip" to ip,
                        "token" to accessToken
                    ))
                } catch (e: Exception) {
                    server?.stop()
                    server = null
                    accessToken = null
                    appContext.reactContext?.applicationContext?.let {
                        StreamingForegroundService.stop(it)
                    }
                    promise.reject("ERR_SERVER_START", "Failed to start server", e)
                }
            }.start()
        }

        AsyncFunction("stopServer") { promise: Promise ->
            try {
                server?.stop()
                server = null
                accessToken = null
                appContext.reactContext?.applicationContext?.let {
                    StreamingForegroundService.stop(it)
                }
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
            requestedMaxHeight: Int?,
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
                    var remuxFile: File? = null
                    var connection: HttpURLConnection? = null
                    var input: InputStream? = null
                    try {
                        val isHls = format.equals("hls", ignoreCase = true)
                        var contentType = if (isHls) "video/mp2t" else "video/mp4"
                        var totalBytes = -1L
                        var downloadedBytes = 0L

                        if (isHls) {
                            val snapshot = activeServer.fetchHlsSnapshot(
                                url,
                                referer,
                                origin,
                                userAgent,
                                maxHeight = requestedMaxHeight
                                    ?.coerceIn(360, 1080)
                                    ?: 720
                            )
                            val estimatedBytes = estimatedHlsSize(snapshot)
                            if (
                                estimatedBytes != null &&
                                estimatedBytes + 100L * 1024L * 1024L > cacheDirectory.usableSpace
                            ) {
                                throw IOException("Not enough free space for cached media")
                            }
                            downloadedBytes = cacheHlsInParallel(
                                activeServer,
                                snapshot,
                                referer,
                                origin,
                                userAgent,
                                partialFile,
                                cacheDirectory
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
                            activeCacheResource = input
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
                                            mutableMapOf<String, Any>(
                                                "bytesDownloaded" to downloadedBytes.toDouble(),
                                                "phase" to "downloading"
                                            ).apply {
                                                if (totalBytes > 0) {
                                                    put("totalBytes", totalBytes.toDouble())
                                                }
                                            }
                                        )
                                        lastProgressAt = now
                                    }
                                }
                                output.fd.sync()
                            }
                        }

                        if (cacheCancelled.get()) {
                            throw IOException("Media download cancelled")
                        }
                        if (downloadedBytes <= 0L) {
                            throw IOException("Downloaded media is empty")
                        }

                        var sourceFile = partialFile
                        if (isHls && !cacheCancelled.get()) {
                            remuxFile = File(cacheDirectory, "$cacheId.mp4.part")
                            sendEvent(
                                "onCacheProgress",
                                mapOf(
                                    "bytesDownloaded" to downloadedBytes.toDouble(),
                                    "totalBytes" to downloadedBytes.toDouble(),
                                    "phase" to "optimizing",
                                    "phaseProgress" to 0.0
                                )
                            )
                            val context = appContext.reactContext?.applicationContext
                                ?: throw IllegalStateException("ReactContext unavailable")
                            if (remuxTsToMp4(
                                    context,
                                    partialFile,
                                    remuxFile,
                                    downloadedBytes
                                )) {
                                sourceFile = remuxFile
                                contentType = "video/mp4"
                            }
                        }

                        val extension = cachedExtension(contentType, isHls = false)
                        finalFile = activeServer.cacheFile(cacheId, extension)
                        if (!sourceFile.renameTo(finalFile)) {
                            throw IOException("Could not finalize cached media")
                        }
                        if (sourceFile !== partialFile) {
                            partialFile.delete()
                        }
                        val finalSizeBytes = finalFile.length()
                        sendEvent(
                            "onCacheProgress",
                            mapOf(
                                "bytesDownloaded" to finalSizeBytes.toDouble(),
                                "totalBytes" to finalSizeBytes.toDouble(),
                                "phase" to if (contentType == "video/mp4") {
                                    "optimizing"
                                } else {
                                    "downloading"
                                },
                                "phaseProgress" to 1.0
                            )
                        )
                        promise.resolve(
                            mapOf(
                                "id" to cacheId,
                                "contentType" to contentType,
                                "sizeBytes" to finalSizeBytes.toDouble()
                            )
                        )
                    } catch (error: Exception) {
                        partialFile.delete()
                        remuxFile?.delete()
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
                        activeCacheExecutor?.shutdownNow()
                        activeCacheExecutor = null
                        activeCacheConnections.clear()
                        Handler(Looper.getMainLooper()).post {
                            activeTransformer?.cancel()
                            activeTransformer = null
                        }
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
            activeCacheExecutor?.shutdownNow()
            synchronized(activeCacheConnections) {
                activeCacheConnections.toList().forEach { it.disconnect() }
                activeCacheConnections.clear()
            }
            Handler(Looper.getMainLooper()).post {
                activeTransformer?.cancel()
                activeTransformer = null
            }
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
