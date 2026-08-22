package expo.modules.localvideoproxy

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicInteger

class StreamingForegroundService : Service() {
    companion object {
        private const val CHANNEL_ID = "horus_tv_streaming"
        private const val NOTIFICATION_ID = 4815
        private const val ACTION_START = "expo.modules.localvideoproxy.START"
        private const val ACTION_SET_MODE = "expo.modules.localvideoproxy.SET_NOTIFICATION_MODE"
        private const val ACTION_UPDATE_PLAYBACK = "expo.modules.localvideoproxy.UPDATE_PLAYBACK"
        private const val ACTION_UPDATE_CACHE = "expo.modules.localvideoproxy.UPDATE_CACHE"
        private const val ACTION_PLAY = "expo.modules.localvideoproxy.MEDIA_PLAY"
        private const val ACTION_PAUSE = "expo.modules.localvideoproxy.MEDIA_PAUSE"
        private const val ACTION_TOGGLE = "expo.modules.localvideoproxy.MEDIA_TOGGLE"
        private const val ACTION_REWIND = "expo.modules.localvideoproxy.MEDIA_REWIND"
        private const val ACTION_FORWARD = "expo.modules.localvideoproxy.MEDIA_FORWARD"
        private const val ACTION_SEEK = "expo.modules.localvideoproxy.MEDIA_SEEK"
        private const val ACTION_STOP = "expo.modules.localvideoproxy.MEDIA_STOP"
        private const val CUSTOM_REWIND = "expo.modules.localvideoproxy.CUSTOM_REWIND"
        private const val CUSTOM_FORWARD = "expo.modules.localvideoproxy.CUSTOM_FORWARD"

        const val MODE_DIRECT = "direct"
        const val MODE_PREPARING = "preparing"
        const val MODE_PLAYER = "player"

        private const val EXTRA_MODE = "mode"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_IMAGE_URL = "imageUrl"
        private const val EXTRA_CAN_SEEK = "canSeek"
        private const val EXTRA_IS_PLAYING = "isPlaying"
        private const val EXTRA_POSITION_SECONDS = "positionSeconds"
        private const val EXTRA_DURATION_SECONDS = "durationSeconds"
        private const val EXTRA_PROGRESS = "progress"
        private const val EXTRA_PHASE = "phase"

        @Volatile
        private var mediaControlHandler: ((String, Double?) -> Unit)? = null
        @Volatile
        private var isServiceRunning = false

        fun setMediaControlHandler(handler: ((String, Double?) -> Unit)?) {
            mediaControlHandler = handler
        }

        private fun startService(context: Context, intent: Intent) {
            if (isServiceRunning || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                context.startService(intent)
            } else {
                context.startForegroundService(intent)
            }
        }

        fun start(context: Context) = startService(
            context,
            Intent(context, StreamingForegroundService::class.java).setAction(ACTION_START)
        )

        fun setNotificationMode(
            context: Context,
            mode: String,
            title: String?,
            imageUrl: String?,
            canSeek: Boolean
        ) = startService(
            context,
            Intent(context, StreamingForegroundService::class.java)
                .setAction(ACTION_SET_MODE)
                .putExtra(EXTRA_MODE, mode)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_IMAGE_URL, imageUrl)
                .putExtra(EXTRA_CAN_SEEK, canSeek)
        )

        fun updatePlayback(
            context: Context,
            isPlaying: Boolean,
            positionSeconds: Double,
            durationSeconds: Double
        ) = startService(
            context,
            Intent(context, StreamingForegroundService::class.java)
                .setAction(ACTION_UPDATE_PLAYBACK)
                .putExtra(EXTRA_IS_PLAYING, isPlaying)
                .putExtra(EXTRA_POSITION_SECONDS, positionSeconds)
                .putExtra(EXTRA_DURATION_SECONDS, durationSeconds)
        )

        fun updateCacheProgress(context: Context, progress: Double, phase: String) = startService(
            context,
            Intent(context, StreamingForegroundService::class.java)
                .setAction(ACTION_UPDATE_CACHE)
                .putExtra(EXTRA_PROGRESS, progress)
                .putExtra(EXTRA_PHASE, phase)
        )

        fun stop(context: Context) {
            context.stopService(Intent(context, StreamingForegroundService::class.java))
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var mediaSession: MediaSession? = null
    private var notificationMode = MODE_DIRECT
    private var mediaTitle = "Lecture TV"
    private var mediaImageUrl: String? = null
    private var mediaArtwork: Bitmap? = null
    private var canSeek = false
    private var isPlaying = true
    private var positionMs = 0L
    private var durationMs = 0L
    private var positionUpdatedAtMs = SystemClock.elapsedRealtime()
    private var cacheProgress = -1.0
    private var cachePhase = "downloading"
    private val artworkGeneration = AtomicInteger(0)

    override fun onCreate() {
        super.onCreate()
        isServiceRunning = true
        createNotificationChannel()
        mediaSession = MediaSession(this, "HorusTvPlayback").apply {
            setFlags(
                MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or
                    MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS
            )
            setCallback(createMediaSessionCallback(), Handler(Looper.getMainLooper()))
            contentIntent()?.let { setSessionActivity(it) }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // A sticky restart cannot recreate the in-memory HTTP/cache engine on
        // its own. Do not keep an orphan wake/Wi-Fi lock; the persisted app job
        // will be retried when Horus is opened again.
        if (intent == null) {
            stopSelf(startId)
            return START_NOT_STICKY
        }
        val commandIntent = intent
        when (commandIntent.action ?: ACTION_START) {
            ACTION_START -> resetToDirectMode()
            ACTION_SET_MODE -> applyNotificationMode(commandIntent)
            ACTION_UPDATE_PLAYBACK -> applyPlaybackUpdate(commandIntent)
            ACTION_UPDATE_CACHE -> applyCacheUpdate(commandIntent)
            ACTION_PLAY -> handlePlay()
            ACTION_PAUSE -> handlePause()
            ACTION_TOGGLE -> if (isPlaying) handlePause() else handlePlay()
            ACTION_REWIND -> handleSeek(currentPositionMs() - 10_000L)
            ACTION_FORWARD -> handleSeek(currentPositionMs() + 10_000L)
            ACTION_SEEK -> handleSeek(
                (commandIntent.getDoubleExtra(EXTRA_POSITION_SECONDS, 0.0) * 1_000.0).toLong()
            )
            ACTION_STOP -> handleStop()
        }
        publishNotification()
        acquireLocks()
        // Keep the foreground service eligible for recreation after Android
        // reclaims the process. The app also persists enough state to retry an
        // interrupted offline download when its UI is recreated.
        return START_STICKY
    }

    override fun onDestroy() {
        isServiceRunning = false
        artworkGeneration.incrementAndGet()
        mediaSession?.isActive = false
        mediaSession?.release()
        mediaSession = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        releaseLocks()
        Log.i("LocalVideoProxy", "TV streaming foreground service stopped")
        super.onDestroy()
    }

    private fun resetToDirectMode() {
        notificationMode = MODE_DIRECT
        mediaSession?.isActive = false
        cacheProgress = -1.0
        cachePhase = "downloading"
        canSeek = false
    }

    private fun applyNotificationMode(intent: Intent) {
        notificationMode = when (intent.getStringExtra(EXTRA_MODE)) {
            MODE_PREPARING -> MODE_PREPARING
            MODE_PLAYER -> MODE_PLAYER
            else -> MODE_DIRECT
        }
        intent.getStringExtra(EXTRA_TITLE)
            ?.takeIf { it.isNotBlank() }
            ?.let { mediaTitle = it.take(200) }
        canSeek = intent.getBooleanExtra(EXTRA_CAN_SEEK, false)
        if (notificationMode == MODE_PLAYER) {
            isPlaying = true
            positionMs = 0L
            durationMs = 0L
            positionUpdatedAtMs = SystemClock.elapsedRealtime()
            mediaSession?.isActive = true
        } else {
            mediaSession?.isActive = false
        }

        val nextImageUrl = intent.getStringExtra(EXTRA_IMAGE_URL)?.takeIf { it.isNotBlank() }
        if (nextImageUrl != mediaImageUrl) {
            mediaImageUrl = nextImageUrl
            mediaArtwork = null
            loadArtwork(nextImageUrl)
        }
    }

    private fun applyPlaybackUpdate(intent: Intent) {
        if (notificationMode != MODE_PLAYER) return
        isPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, isPlaying)
        positionMs = secondsToMs(
            intent.getDoubleExtra(EXTRA_POSITION_SECONDS, positionMs / 1_000.0)
        )
        durationMs = secondsToMs(
            intent.getDoubleExtra(EXTRA_DURATION_SECONDS, durationMs / 1_000.0)
        )
        positionUpdatedAtMs = SystemClock.elapsedRealtime()
    }

    private fun applyCacheUpdate(intent: Intent) {
        if (notificationMode != MODE_PREPARING) return
        cacheProgress = intent.getDoubleExtra(EXTRA_PROGRESS, -1.0).coerceIn(-1.0, 1.0)
        cachePhase = intent.getStringExtra(EXTRA_PHASE) ?: "downloading"
    }

    private fun secondsToMs(seconds: Double): Long {
        if (!seconds.isFinite() || seconds <= 0.0) return 0L
        return (seconds * 1_000.0).toLong()
    }

    private fun currentPositionMs(): Long {
        val elapsed = if (isPlaying) SystemClock.elapsedRealtime() - positionUpdatedAtMs else 0L
        val upperBound = durationMs.takeIf { it > 0L } ?: Long.MAX_VALUE
        return (positionMs + elapsed).coerceIn(0L, upperBound)
    }

    private fun dispatchMediaControl(action: String, positionSeconds: Double? = null) {
        try {
            mediaControlHandler?.invoke(action, positionSeconds)
        } catch (error: Exception) {
            Log.e("LocalVideoProxy", "Unable to dispatch media control $action", error)
        }
    }

    private fun handlePlay() {
        if (notificationMode != MODE_PLAYER) return
        positionMs = currentPositionMs()
        positionUpdatedAtMs = SystemClock.elapsedRealtime()
        isPlaying = true
        dispatchMediaControl("play")
    }

    private fun handlePause() {
        if (notificationMode != MODE_PLAYER) return
        positionMs = currentPositionMs()
        isPlaying = false
        positionUpdatedAtMs = SystemClock.elapsedRealtime()
        dispatchMediaControl("pause")
    }

    private fun handleSeek(requestedPositionMs: Long) {
        if (notificationMode != MODE_PLAYER || !canSeek) return
        val upperBound = durationMs.takeIf { it > 0L } ?: Long.MAX_VALUE
        positionMs = requestedPositionMs.coerceIn(0L, upperBound)
        positionUpdatedAtMs = SystemClock.elapsedRealtime()
        dispatchMediaControl("seek", positionMs / 1_000.0)
    }

    private fun handleStop() {
        if (notificationMode != MODE_PLAYER) return
        positionMs = currentPositionMs()
        isPlaying = false
        positionUpdatedAtMs = SystemClock.elapsedRealtime()
        dispatchMediaControl("stop")
    }

    private fun createMediaSessionCallback() = object : MediaSession.Callback() {
        override fun onPlay() = handleAndPublish { handlePlay() }
        override fun onPause() = handleAndPublish { handlePause() }
        override fun onStop() = handleAndPublish { handleStop() }
        override fun onSeekTo(pos: Long) = handleAndPublish { handleSeek(pos) }
        override fun onRewind() = handleAndPublish { handleSeek(currentPositionMs() - 10_000L) }
        override fun onFastForward() = handleAndPublish { handleSeek(currentPositionMs() + 10_000L) }
        override fun onCustomAction(action: String, extras: android.os.Bundle?) {
            when (action) {
                CUSTOM_REWIND -> handleAndPublish { handleSeek(currentPositionMs() - 10_000L) }
                CUSTOM_FORWARD -> handleAndPublish { handleSeek(currentPositionMs() + 10_000L) }
            }
        }
    }

    private fun handleAndPublish(command: () -> Unit) {
        command()
        publishNotification()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Diffusion vers la TV",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Maintient la diffusion vidéo active lorsque l’écran est éteint"
                setShowBadge(false)
            }
        )
    }

    private fun notificationBuilder(): Notification.Builder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            Notification.Builder(this)
        }

    private fun contentIntent(): PendingIntent? =
        packageManager.getLaunchIntentForPackage(packageName)?.let {
            it.data = Uri.parse("horusremote://tv-remote")
            it.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

    private fun createNotification(): Notification = when (notificationMode) {
        MODE_PREPARING -> createPreparingNotification()
        MODE_PLAYER -> createPlayerNotification()
        else -> createDirectNotification()
    }

    private fun createDirectNotification(): Notification = notificationBuilder()
        .setSmallIcon(android.R.drawable.stat_sys_upload)
        .setContentTitle("Horus diffuse vers la TV")
        .setContentText("Le téléphone reste disponible comme serveur vidéo")
        .setCategory(Notification.CATEGORY_SERVICE)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .apply { contentIntent()?.let { setContentIntent(it) } }
        .build()

    private fun createPreparingNotification(): Notification {
        val optimizing = cachePhase == "optimizing"
        val builder = notificationBuilder()
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(mediaTitle)
            .setContentText(
                if (optimizing) "Optimisation du fichier MP4"
                else "Téléchargement complet pour la TV"
            )
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .apply {
                contentIntent()?.let { setContentIntent(it) }
                mediaArtwork?.let { setLargeIcon(it) }
            }
        if (cacheProgress >= 0.0) {
            builder.setProgress(1_000, (cacheProgress * 1_000.0).toInt(), false)
        } else {
            builder.setProgress(0, 0, true)
        }
        return builder.build()
    }

    private fun createPlayerNotification(): Notification {
        val session = mediaSession ?: return createDirectNotification()
        val displayedPosition = currentPositionMs()
        val stateActions = (
            PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
                PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP
            ) or if (canSeek) {
                PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_REWIND or
                    PlaybackState.ACTION_FAST_FORWARD
            } else {
                0L
            }
        session.setMetadata(
            MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, mediaTitle)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, mediaTitle)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, "Lecture sur la TV")
                .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs)
                .apply {
                    mediaArtwork?.let {
                        putBitmap(MediaMetadata.METADATA_KEY_ART, it)
                        putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, it)
                    }
                }
                .build()
        )
        val playbackState = PlaybackState.Builder()
            .setActions(stateActions)
            .apply {
                if (canSeek) {
                    addCustomAction(
                        PlaybackState.CustomAction.Builder(
                            CUSTOM_REWIND,
                            "Reculer de 10 secondes",
                            android.R.drawable.ic_media_rew
                        ).build()
                    )
                    addCustomAction(
                        PlaybackState.CustomAction.Builder(
                            CUSTOM_FORWARD,
                            "Avancer de 10 secondes",
                            android.R.drawable.ic_media_ff
                        ).build()
                    )
                }
            }
            .setState(
                if (isPlaying) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                displayedPosition,
                if (isPlaying) 1.0f else 0.0f,
                SystemClock.elapsedRealtime()
            )
            .build()
        session.setPlaybackState(playbackState)
        session.isActive = true

        val actions = mutableListOf<Notification.Action>()
        if (canSeek) {
            actions += notificationAction(
                android.R.drawable.ic_media_rew,
                "Reculer de 10 secondes",
                ACTION_REWIND
            )
        }
        actions += notificationAction(
            if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
            if (isPlaying) "Pause" else "Lecture",
            ACTION_TOGGLE
        )
        if (canSeek) {
            actions += notificationAction(
                android.R.drawable.ic_media_ff,
                "Avancer de 10 secondes",
                ACTION_FORWARD
            )
        }
        actions += notificationAction(
            android.R.drawable.ic_menu_close_clear_cancel,
            "Arrêter la diffusion",
            ACTION_STOP
        )

        val compactActions = if (canSeek) intArrayOf(0, 1, 2) else intArrayOf(0, 1)
        return notificationBuilder()
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle(mediaTitle)
            .setContentText(
                if (canSeek) "Lecture sur la TV • avance rapide disponible"
                else "Lecture sur la TV • déplacement indisponible"
            )
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setStyle(
                Notification.MediaStyle()
                    .setMediaSession(session.sessionToken)
                    .setShowActionsInCompactView(*compactActions)
            )
            .apply {
                contentIntent()?.let { setContentIntent(it) }
                mediaArtwork?.let { setLargeIcon(it) }
                actions.forEach { addAction(it) }
            }
            .build()
    }

    private fun notificationAction(icon: Int, title: String, action: String): Notification.Action {
        val pendingIntent = PendingIntent.getService(
            this,
            action.hashCode(),
            Intent(this, StreamingForegroundService::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Action.Builder(icon, title, pendingIntent).build()
    }

    private fun publishNotification() {
        val notification = createNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun loadArtwork(imageUrl: String?) {
        val generation = artworkGeneration.incrementAndGet()
        if (imageUrl == null) return
        Thread {
            val bitmap = downloadArtwork(imageUrl)
            if (generation != artworkGeneration.get() || bitmap == null) return@Thread
            Handler(Looper.getMainLooper()).post {
                if (generation != artworkGeneration.get()) return@post
                mediaArtwork = bitmap
                publishNotification()
            }
        }.apply {
            name = "HorusNotificationArtwork"
            start()
        }
    }

    private fun downloadArtwork(imageUrl: String): Bitmap? {
        var connection: HttpURLConnection? = null
        return try {
            val url = URL(imageUrl)
            if (url.protocol != "https" && url.protocol != "http") return null
            connection = url.openConnection() as HttpURLConnection
            connection.connectTimeout = 5_000
            connection.readTimeout = 8_000
            connection.instanceFollowRedirects = true
            connection.setRequestProperty("User-Agent", "HorusRemote/1.3")
            connection.connect()
            if (connection.responseCode !in 200..299) return null
            val maximumBytes = 5 * 1024 * 1024
            if (connection.contentLength > maximumBytes) return null
            val bytes = ByteArrayOutputStream(
                connection.contentLength.takeIf { it in 1..maximumBytes } ?: 256 * 1024
            )
            connection.inputStream.use { input ->
                val buffer = ByteArray(32 * 1024)
                var total = 0
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    total += read
                    if (total > maximumBytes) return null
                    bytes.write(buffer, 0, read)
                }
            }
            val data = bytes.toByteArray()
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
            var sampleSize = 1
            while (bounds.outWidth / sampleSize > 512 || bounds.outHeight / sampleSize > 512) {
                sampleSize *= 2
            }
            BitmapFactory.decodeByteArray(
                data,
                0,
                data.size,
                BitmapFactory.Options().apply { inSampleSize = sampleSize }
            )
        } catch (error: Exception) {
            Log.w("LocalVideoProxy", "Unable to load notification artwork", error)
            null
        } finally {
            connection?.disconnect()
        }
    }

    private fun acquireLocks() {
        try {
            if (wakeLock?.isHeld != true) {
                val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
                wakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "Horus:LocalVideoProxyWakeLock"
                ).apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }
            if (wifiLock?.isHeld != true) {
                val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE)
                    as WifiManager
                wifiLock = wifiManager.createWifiLock(
                    WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                    "Horus:LocalVideoProxyWifiLock"
                ).apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }
        } catch (error: Exception) {
            Log.e("LocalVideoProxy", "Failed to acquire streaming locks", error)
        }
    }

    private fun releaseLocks() {
        try {
            if (wakeLock?.isHeld == true) wakeLock?.release()
            if (wifiLock?.isHeld == true) wifiLock?.release()
        } catch (error: Exception) {
            Log.e("LocalVideoProxy", "Failed to release streaming locks", error)
        } finally {
            wakeLock = null
            wifiLock = null
        }
    }
}
