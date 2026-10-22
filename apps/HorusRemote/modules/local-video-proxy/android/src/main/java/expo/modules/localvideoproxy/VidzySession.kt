package expo.modules.localvideoproxy

import android.annotation.SuppressLint
import android.app.Activity
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONTokener
import java.io.ByteArrayInputStream

/** Isolated browser session: no native JS bridge, file access, popups or media transfer. */
class VidzySession {
    private val handler = Handler(Looper.getMainLooper())
    private var close: (() -> Unit)? = null

    fun cancel() { handler.post { close?.invoke() } }

    @SuppressLint("SetJavaScriptEnabled")
    fun resolve(activity: Activity, embed: String, referer: String,
                complete: (String?, String?, String?) -> Unit) {
        handler.post {
            close?.invoke()
            val uri = Uri.parse(embed)
            val parent = Uri.parse(referer)
            if (uri.scheme != "https" || uri.host != "vidzy.cc" ||
                !uri.path.orEmpty().matches(Regex("/embed-[A-Za-z0-9]+\\.html")) ||
                parent.scheme != "https" || parent.host != "vidzy.org") {
                complete(null, null, "Invalid Vidzy session URL")
                return@post
            }
            var view: WebView? = null
            var finished = false
            val tasks = Handler(Looper.getMainLooper())
            fun finish(key: String?, agent: String?, error: String?) {
                if (finished) return
                finished = true
                tasks.removeCallbacksAndMessages(null)
                view?.let { browser ->
                    browser.stopLoading()
                    (browser.parent as? ViewGroup)?.removeView(browser)
                    browser.destroy()
                }
                view = null
                close = null
                complete(key, agent, error)
            }
            close = { finish(null, null, "Vidzy session cancelled") }
            try {
                val browser = WebView(activity)
                view = browser
                browser.settings.apply {
                    javaScriptEnabled = true
                    allowFileAccess = false
                    allowContentAccess = false
                    domStorageEnabled = false
                    javaScriptCanOpenWindowsAutomatically = false
                    setSupportMultipleWindows(false)
                    mediaPlaybackRequiresUserGesture = true
                    mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
                }
                val agent = browser.settings.userAgentString
                fun blocked() = WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))
                browser.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean =
                        r.url.toString() != embed
                    override fun shouldInterceptRequest(v: WebView, r: WebResourceRequest): WebResourceResponse? {
                        val host = r.url.host.orEmpty().lowercase()
                        val path = r.url.path.orEmpty()
                        if (r.url.scheme != "https" || !(host == "vidzy.cc" || host.endsWith(".vidzy.cc")) ||
                            path.startsWith("/hls2/") || path.startsWith("/v/") ||
                            path.endsWith(".m3u8") || path.endsWith(".ts") || path.endsWith(".mp4")) return blocked()
                        return null
                    }
                }
                browser.alpha = 0f
                activity.addContentView(browser, ViewGroup.LayoutParams(1, 1))
                browser.loadUrl(embed, mapOf("Referer" to referer))
                val poll = object : Runnable {
                    override fun run() {
                        if (finished) return
                        browser.evaluateJavascript("typeof window.__vzgk === 'string' ? window.__vzgk : ''") { encoded ->
                            if (finished) return@evaluateJavascript
                            val key = try { JSONTokener(encoded).nextValue() as? String } catch (_: Exception) { null }
                            if (key != null && key.length in 1..4096 && !key.any { it.isISOControl() }) {
                                finish(key, agent, null)
                            } else tasks.postDelayed(this, 250)
                        }
                    }
                }
                tasks.post(poll)
                tasks.postDelayed({ finish(null, null, "Vidzy browser validation timed out") }, 20_000)
            } catch (error: Exception) {
                finish(null, null, error.message ?: "Vidzy browser validation failed")
            }
        }
    }
}
