import ExpoModulesCore
import GCDWebServer
import Foundation

class ProxyStreamer: NSObject, URLSessionDataDelegate {
    var responseBlock: GCDWebServerCompletionBlock?
    var task: URLSessionDataTask?
    var dataQueue = [Data]()
    var isFinished = false
    var error: Error?
    let semaphore = DispatchSemaphore(value: 0)
    let queueLock = NSLock()
    
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        if let httpResponse = response as? HTTPURLResponse {
            let serverResponse = GCDWebServerStreamedResponse(contentType: httpResponse.mimeType ?? "video/mp4", asyncStreamBlock: { [weak self] completion in
                DispatchQueue.global().async {
                    guard let self = self else { completion(Data(), nil); return }
                    while true {
                        self.queueLock.lock()
                        if !self.dataQueue.isEmpty {
                            let data = self.dataQueue.removeFirst()
                            self.queueLock.unlock()
                            completion(data, nil)
                            return
                        }
                        let isFinished = self.isFinished
                        let error = self.error
                        self.queueLock.unlock()
                        if isFinished {
                            completion(Data(), error)
                            return
                        }
                        self.semaphore.wait()
                    }
                }
            })
            
            for (key, value) in httpResponse.allHeaderFields {
                if let keyStr = key as? String, let valStr = value as? String {
                    let kLower = keyStr.lowercased()
                    if kLower != "content-type" && kLower != "transfer-encoding" {
                        serverResponse.setValue(valStr, forAdditionalHeader: keyStr)
                    }
                }
            }
            serverResponse.statusCode = httpResponse.statusCode
            self.responseBlock?(serverResponse)
            self.responseBlock = nil
        }
        completionHandler(.allow)
    }
    
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        queueLock.lock()
        self.dataQueue.append(data)
        queueLock.unlock()
        self.semaphore.signal()
    }
    
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        queueLock.lock()
        self.error = error
        self.isFinished = true
        queueLock.unlock()
        self.semaphore.signal()
    }
}

class DirectCacheDownloader: NSObject, URLSessionDataDelegate {
    private let destination: URL
    private let progressBlock: (Int64, Int64?) -> Void
    private let completionBlock: (Bool, String, Int64, Error?) -> Void
    private let stateLock = NSLock()
    private var fileHandle: FileHandle?
    private var task: URLSessionDataTask?
    private var session: URLSession?
    private var isCompleted = false
    private var responseIsValid = false
    private var contentType = "video/mp4"
    private var downloadedBytes: Int64 = 0
    private var totalBytes: Int64?

    init(
        destination: URL,
        progress: @escaping (Int64, Int64?) -> Void,
        completion: @escaping (Bool, String, Int64, Error?) -> Void
    ) {
        self.destination = destination
        self.progressBlock = progress
        self.completionBlock = completion
        super.init()
    }

    func start(request: URLRequest) throws {
        FileManager.default.createFile(atPath: destination.path, contents: nil)
        fileHandle = try FileHandle(forWritingTo: destination)
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 45
        config.timeoutIntervalForResource = 60 * 60 * 6
        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        self.session = session
        let task = session.dataTask(with: request)
        self.task = task
        task.resume()
    }

    func cancel() {
        task?.cancel()
        finish(success: false, error: NSError(
            domain: "HorusMediaCache",
            code: -999,
            userInfo: [NSLocalizedDescriptionKey: "Media download cancelled"]
        ))
    }

    private func finish(success: Bool, error: Error?) {
        stateLock.lock()
        if isCompleted {
            stateLock.unlock()
            return
        }
        isCompleted = true
        stateLock.unlock()

        try? fileHandle?.close()
        fileHandle = nil
        session?.finishTasksAndInvalidate()
        completionBlock(success, contentType, downloadedBytes, error)
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let response = response as? HTTPURLResponse,
              (200...299).contains(response.statusCode) else {
            completionHandler(.cancel)
            return
        }
        responseIsValid = true
        contentType = response.mimeType ?? "video/mp4"
        if response.expectedContentLength > 0 {
            totalBytes = response.expectedContentLength
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        fileHandle?.write(data)
        downloadedBytes += Int64(data.count)
        progressBlock(downloadedBytes, totalBytes)
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        let success = responseIsValid && error == nil && downloadedBytes > 0
        finish(success: success, error: error)
    }
}

private struct HlsSegment {
    let sequence: Int64
    let url: URL
}

private struct HlsPlaylistSnapshot {
    let mediaPlaylistUrl: URL
    let segments: [HlsSegment]
    let mediaSequence: Int64
    let targetDuration: TimeInterval
    let hasEndList: Bool
}

private struct HlsVariant {
    let bandwidth: Int64
    let url: URL
    let codecs: String?
    let width: Int?
    let height: Int?
    let usesExternalAudio: Bool
}

class HlsStitcher: NSObject, URLSessionDataDelegate {
    var responseBlock: GCDWebServerCompletionBlock?
    var dataQueue = [Data]()
    var isFinished = false
    var error: Error?
    let semaphore = DispatchSemaphore(value: 0)
    let queueLock = NSLock()
    var session: URLSession!
    var userAgent = ""
    var referer: String?
    var origin: String?

    private var rootPlaylistUrl: URL?
    private var snapshot: HlsPlaylistSnapshot?
    private var nextSequence: Int64 = 0
    private var currentSegment: HlsSegment?
    private var shouldRefreshCurrentSegment = false
    private var shouldRetryCurrentSegment = false
    private var currentSegmentReceivedData = false
    private var currentSegmentRetries = 0
    private var refreshAttempts = 0
    private var isCaching = false
    private var cacheWasCancelled = false
    private var cacheFileHandle: FileHandle?
    private var cacheProgressBlock: ((Int64) -> Void)?
    private var cacheCompletionBlock: ((Bool, Int64, Error?) -> Void)?
    private var cachedBytes: Int64 = 0
    private var maxHeight = 1080

    override init() {
        super.init()
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 90
        self.session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    private func capture(_ pattern: String, in value: String, group: Int = 1) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(
                in: value,
                range: NSRange(value.startIndex..., in: value)
              ),
              match.numberOfRanges > group,
              let range = Range(match.range(at: group), in: value) else {
            return nil
        }
        return String(value[range])
    }

    private func resolvePlaylistUri(_ rawUri: String, relativeTo playlistUrl: URL) -> URL? {
        guard let resolved = URL(string: rawUri, relativeTo: playlistUrl)?.absoluteURL else {
            return nil
        }

        if URL(string: rawUri)?.scheme == nil,
           !rawUri.contains("?"),
           resolved.query == nil,
           let inheritedQuery = playlistUrl.query,
           var components = URLComponents(url: resolved, resolvingAgainstBaseURL: false) {
            components.percentEncodedQuery = inheritedQuery
            return components.url
        }

        return resolved
    }

    private func selectCompatibleVariant(_ variants: [HlsVariant]) -> HlsVariant? {
        let maxWidth = maxHeight <= 720 ? 1280 : 1920
        let codecCompatible = variants.filter { variant in
            let codecs = variant.codecs?.lowercased() ?? ""
            return codecs.isEmpty ||
                ((codecs.contains("avc1") || codecs.contains("h264")) &&
                 !codecs.contains("hev1") &&
                 !codecs.contains("hvc1") &&
                 !codecs.contains("av01"))
        }
        let resolutionCompatible = codecCompatible.filter { variant in
            (variant.width == nil || variant.width! <= maxWidth) &&
                (variant.height == nil || variant.height! <= maxHeight)
        }
        let muxedCandidates = resolutionCompatible.filter { !$0.usesExternalAudio }
        let candidates: [HlsVariant]
        if !muxedCandidates.isEmpty {
            candidates = muxedCandidates
        } else if !resolutionCompatible.isEmpty {
            candidates = resolutionCompatible
        } else {
            return codecCompatible.min(by: { $0.bandwidth < $1.bandwidth })
                ?? variants.min(by: { $0.bandwidth < $1.bandwidth })
        }
        return candidates.max(by: { $0.bandwidth < $1.bandwidth })
            ?? variants.min(by: { $0.bandwidth < $1.bandwidth })
    }

    private func fetchHlsSnapshot(
        url: URL,
        referer: String?,
        origin: String?,
        userAgent: String,
        depth: Int = 0,
        completion: @escaping (HlsPlaylistSnapshot?) -> Void
    ) {
        guard depth < 6 else { completion(nil); return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 30
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        if let referer = referer { request.setValue(referer, forHTTPHeaderField: "Referer") }
        if let origin = origin { request.setValue(origin, forHTTPHeaderField: "Origin") }

        URLSession.shared.dataTask(with: request) { data, response, _ in
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode),
                  let data = data,
                  let text = String(data: data, encoding: .utf8),
                  text.components(separatedBy: .newlines)
                    .contains(where: { $0.trimmingCharacters(in: .whitespaces) == "#EXTM3U" }) else {
                completion(nil)
                return
            }

            var segments = [HlsSegment]()
            var variants = [HlsVariant]()
            var pendingVariant: (
                bandwidth: Int64,
                codecs: String?,
                width: Int?,
                height: Int?,
                usesExternalAudio: Bool
            )?
            var mediaSequence: Int64 = 0
            var targetDuration: TimeInterval = 4
            var hasEndList = false
            var unsupportedEncryption = false
            var usesFragmentedMp4 = false

            for line in text.components(separatedBy: .newlines) {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.hasPrefix("#EXT-X-STREAM-INF:") {
                    let attributes = String(trimmed.dropFirst("#EXT-X-STREAM-INF:".count))
                    let width = self.capture(
                        #"(?:^|,)RESOLUTION=(\d+)x(\d+)"#,
                        in: attributes
                    )
                    let height = self.capture(
                        #"(?:^|,)RESOLUTION=\d+x(\d+)"#,
                        in: attributes
                    )
                    pendingVariant = (
                        bandwidth: Int64(
                            self.capture(#"(?:^|,)BANDWIDTH=(\d+)"#, in: attributes) ?? ""
                        ) ?? 0,
                        codecs: self.capture(#"(?:^|,)CODECS="([^"]+)""#, in: attributes),
                        width: Int(width ?? ""),
                        height: Int(height ?? ""),
                        usesExternalAudio: self.capture(
                            #"(?:^|,)AUDIO="([^"]+)""#,
                            in: attributes
                        ) != nil
                    )
                } else if trimmed.hasPrefix("#EXT-X-KEY:") && !trimmed.contains("METHOD=NONE") {
                    unsupportedEncryption = true
                } else if trimmed.hasPrefix("#EXT-X-MAP:") {
                    usesFragmentedMp4 = true
                } else if trimmed.hasPrefix("#EXT-X-MEDIA-SEQUENCE:") {
                    mediaSequence = Int64(
                        (trimmed.components(separatedBy: ":").last ?? "")
                            .trimmingCharacters(in: .whitespaces)
                    ) ?? 0
                } else if trimmed.hasPrefix("#EXT-X-TARGETDURATION:") {
                    targetDuration = TimeInterval(
                        (trimmed.components(separatedBy: ":").last ?? "")
                            .trimmingCharacters(in: .whitespaces)
                    ) ?? 4
                } else if trimmed == "#EXT-X-ENDLIST" {
                    hasEndList = true
                } else if !trimmed.isEmpty && !trimmed.hasPrefix("#"),
                          let resolved = self.resolvePlaylistUri(trimmed, relativeTo: url) {
                    if let variant = pendingVariant {
                        variants.append(HlsVariant(
                            bandwidth: variant.bandwidth,
                            url: resolved,
                            codecs: variant.codecs,
                            width: variant.width,
                            height: variant.height,
                            usesExternalAudio: variant.usesExternalAudio
                        ))
                        pendingVariant = nil
                    } else {
                        segments.append(HlsSegment(
                            sequence: mediaSequence + Int64(segments.count),
                            url: resolved
                        ))
                    }
                }
            }

            if let selectedVariant = self.selectCompatibleVariant(variants) {
                self.fetchHlsSnapshot(
                    url: selectedVariant.url,
                    referer: referer,
                    origin: origin,
                    userAgent: userAgent,
                    depth: depth + 1,
                    completion: completion
                )
                return
            }

            guard !unsupportedEncryption, !usesFragmentedMp4, !segments.isEmpty else {
                completion(nil)
                return
            }

            completion(HlsPlaylistSnapshot(
                mediaPlaylistUrl: url,
                segments: segments,
                mediaSequence: mediaSequence,
                targetDuration: min(30, max(1, targetDuration)),
                hasEndList: hasEndList
            ))
        }.resume()
    }

    func fetchM3u8(
        urlStr: String,
        referer: String?,
        origin: String?,
        userAgent: String,
        completion: @escaping (Bool) -> Void
    ) {
        guard let url = URL(string: urlStr) else { completion(false); return }
        self.rootPlaylistUrl = url
        self.userAgent = userAgent
        self.referer = referer
        self.origin = origin
        fetchHlsSnapshot(
            url: url,
            referer: referer,
            origin: origin,
            userAgent: userAgent
        ) { snapshot in
            guard let snapshot = snapshot else { completion(false); return }
            self.snapshot = snapshot
            self.nextSequence = snapshot.mediaSequence
            completion(true)
        }
    }

    func startStreaming(responseBlock: @escaping GCDWebServerCompletionBlock) {
        self.responseBlock = responseBlock

        let serverResponse = GCDWebServerStreamedResponse(
            contentType: "video/mp2t",
            asyncStreamBlock: { [weak self] completion in
                DispatchQueue.global().async {
                    guard let self = self else { completion(Data(), nil); return }
                    while true {
                        self.queueLock.lock()
                        if !self.dataQueue.isEmpty {
                            let data = self.dataQueue.removeFirst()
                            self.queueLock.unlock()
                            completion(data, nil)
                            return
                        }
                        let isFinished = self.isFinished
                        let error = self.error
                        self.queueLock.unlock()
                        if isFinished {
                            completion(Data(), error)
                            return
                        }
                        self.semaphore.wait()
                    }
                }
            }
        )
        serverResponse.setValue("*", forAdditionalHeader: "Access-Control-Allow-Origin")
        serverResponse.setValue("Streaming", forAdditionalHeader: "transferMode.dlna.org")
        serverResponse.setValue(
            "DLNA.ORG_OP=00;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000",
            forAdditionalHeader: "contentFeatures.dlna.org"
        )
        responseBlock(serverResponse)
        downloadNextSegment()
    }

    func cacheToFile(
        urlStr: String,
        referer: String?,
        origin: String?,
        userAgent: String,
        maxHeight: Int,
        destination: URL,
        progress: @escaping (Int64) -> Void,
        completion: @escaping (Bool, Int64, Error?) -> Void
    ) {
        self.maxHeight = maxHeight <= 720 ? 720 : 1080
        isCaching = true
        cacheProgressBlock = progress
        cacheCompletionBlock = completion
        FileManager.default.createFile(atPath: destination.path, contents: nil)
        do {
            cacheFileHandle = try FileHandle(forWritingTo: destination)
        } catch {
            completion(false, 0, error)
            return
        }

        fetchM3u8(
            urlStr: urlStr,
            referer: referer,
            origin: origin,
            userAgent: userAgent
        ) { success in
            if success && !self.cacheWasCancelled {
                self.downloadNextSegment()
            } else {
                self.finishStreaming(
                    success: false,
                    error: NSError(
                        domain: "HorusMediaCache",
                        code: 1,
                        userInfo: [NSLocalizedDescriptionKey: "Unable to resolve complete HLS media"]
                    )
                )
            }
        }
    }

    func cancelCaching() {
        cacheWasCancelled = true
        session.invalidateAndCancel()
        finishStreaming(
            success: false,
            error: NSError(
                domain: "HorusMediaCache",
                code: -999,
                userInfo: [NSLocalizedDescriptionKey: "Media download cancelled"]
            )
        )
    }

    private func finishStreaming(success: Bool = true, error: Error? = nil) {
        queueLock.lock()
        if isFinished {
            queueLock.unlock()
            return
        }
        isFinished = true
        queueLock.unlock()
        try? cacheFileHandle?.close()
        cacheFileHandle = nil
        if let completion = cacheCompletionBlock {
            cacheCompletionBlock = nil
            completion(success, cachedBytes, error)
        }
        semaphore.signal()
    }

    private func refreshPlaylist() {
        guard let rootPlaylistUrl = rootPlaylistUrl,
              let currentSnapshot = snapshot else {
            finishStreaming(success: false)
            return
        }
        if currentSnapshot.hasEndList {
            finishStreaming()
            return
        }
        if refreshAttempts >= 12 {
            print("[Proxy] No new HLS segment after \(refreshAttempts) refresh attempts")
            finishStreaming(
                success: !isCaching,
                error: isCaching
                    ? NSError(
                        domain: "HorusMediaCache",
                        code: 2,
                        userInfo: [NSLocalizedDescriptionKey: "HLS playlist ended without ENDLIST"]
                    )
                    : nil
            )
            return
        }

        refreshAttempts += 1
        let delay = min(5, max(0.5, currentSnapshot.targetDuration / 2))
        DispatchQueue.global().asyncAfter(deadline: .now() + delay) {
            self.fetchHlsSnapshot(
                url: rootPlaylistUrl,
                referer: self.referer,
                origin: self.origin,
                userAgent: self.userAgent
            ) { freshSnapshot in
                if let freshSnapshot = freshSnapshot {
                    self.snapshot = freshSnapshot
                    if freshSnapshot.segments.contains(where: {
                        $0.sequence >= self.nextSequence
                    }) {
                        self.refreshAttempts = 0
                        self.downloadNextSegment()
                        return
                    }
                    if freshSnapshot.hasEndList {
                        self.finishStreaming()
                        return
                    }
                }
                self.refreshPlaylist()
            }
        }
    }

    func downloadNextSegment() {
        guard let snapshot = snapshot else {
            finishStreaming()
            return
        }
        guard let segment = snapshot.segments.first(where: {
            $0.sequence >= nextSequence
        }) else {
            refreshPlaylist()
            return
        }

        if currentSegment?.sequence != segment.sequence {
            currentSegmentRetries = 0
        }
        currentSegment = segment
        shouldRefreshCurrentSegment = false
        shouldRetryCurrentSegment = false
        currentSegmentReceivedData = false
        print(
            "[Proxy] Pushing HLS segment sequence \(segment.sequence) to TV " +
            "(attempt \(currentSegmentRetries + 1))"
        )
        var request = URLRequest(url: segment.url)
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        if let referer = referer { request.setValue(referer, forHTTPHeaderField: "Referer") }
        if let origin = origin { request.setValue(origin, forHTTPHeaderField: "Origin") }
        session.dataTask(with: request).resume()
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let response = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            return
        }
        if response.statusCode == 401 || response.statusCode == 403 || response.statusCode == 410 {
            shouldRefreshCurrentSegment = true
            completionHandler(.cancel)
        } else {
            let isSuccessful = (200...299).contains(response.statusCode)
            shouldRetryCurrentSegment = !isSuccessful
            completionHandler(isSuccessful ? .allow : .cancel)
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        currentSegmentReceivedData = true
        if isCaching {
            cacheFileHandle?.write(data)
            cachedBytes += Int64(data.count)
            cacheProgressBlock?(cachedBytes)
            return
        }
        queueLock.lock()
        dataQueue.append(data)
        queueLock.unlock()
        semaphore.signal()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        queueLock.lock()
        let alreadyFinished = isFinished
        queueLock.unlock()
        if alreadyFinished {
            return
        }
        guard let currentSegment = currentSegment else {
            downloadNextSegment()
            return
        }
        if shouldRefreshCurrentSegment {
            refreshAttempts = 0
            refreshPlaylist()
            return
        }
        if (shouldRetryCurrentSegment || error != nil) &&
           !currentSegmentReceivedData &&
           currentSegmentRetries < 2 {
            currentSegmentRetries += 1
            DispatchQueue.global().asyncAfter(
                deadline: .now() + (0.5 * Double(currentSegmentRetries))
            ) {
                self.downloadNextSegment()
            }
            return
        }
        if isCaching && (shouldRetryCurrentSegment || error != nil) {
            finishStreaming(
                success: false,
                error: error ?? NSError(
                    domain: "HorusMediaCache",
                    code: 3,
                    userInfo: [
                        NSLocalizedDescriptionKey:
                            "HLS segment \(currentSegment.sequence) failed after retries"
                    ]
                )
            )
            return
        }
        nextSequence = currentSegment.sequence + 1
        downloadNextSegment()
    }
}

public class LocalVideoProxyModule: Module {
  private var webServer: GCDWebServer?
  private var activeStreamers = [ProxyStreamer]()
  private var activeStitchers = [HlsStitcher]()
  private var accessToken: String?
  private var activeCacheDownloader: DirectCacheDownloader?
  private var activeCacheStitcher: HlsStitcher?
  private var isCacheBusy = false
  private var cacheWasCancelled = false
  private let cacheStateLock = NSLock()

  private func cacheDirectory() throws -> URL {
    let caches = try FileManager.default.url(
      for: .cachesDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    let directory = caches.appendingPathComponent(
      "HorusMediaCache",
      isDirectory: true
    )
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true
    )
    return directory
  }

  private func clearCacheDirectory() throws {
    let directory = try cacheDirectory()
    for file in try FileManager.default.contentsOfDirectory(
      at: directory,
      includingPropertiesForKeys: nil
    ) {
      try? FileManager.default.removeItem(at: file)
    }
  }

  private func cachedExtension(contentType: String, isHls: Bool) -> String {
    if isHls { return "ts" }
    if contentType.localizedCaseInsensitiveContains("matroska") { return "mkv" }
    if contentType.localizedCaseInsensitiveContains("webm") { return "webm" }
    if contentType.localizedCaseInsensitiveContains("mp2t") { return "ts" }
    return "mp4"
  }

  private func cachedContentType(for file: URL) -> String {
    switch file.pathExtension.lowercased() {
    case "ts":
      return "video/mp2t"
    case "mkv":
      return "video/x-matroska"
    case "webm":
      return "video/webm"
    default:
      return "video/mp4"
    }
  }

  private func directContentType(for url: URL) -> String {
    switch url.pathExtension.lowercased() {
    case "ts", "m2ts":
      return "video/mp2t"
    case "mkv":
      return "video/x-matroska"
    case "webm":
      return "video/webm"
    case "m3u8":
      return "application/vnd.apple.mpegurl"
    default:
      return "video/mp4"
    }
  }

  private func findCachedMedia(id: String) -> URL? {
    guard id.range(of: #"^[a-f0-9]{32}$"#, options: .regularExpression) != nil,
          let files = try? FileManager.default.contentsOfDirectory(
            at: cacheDirectory(),
            includingPropertiesForKeys: nil
          ) else {
      return nil
    }
    return files.first {
      $0.lastPathComponent.hasPrefix("\(id).") &&
        $0.pathExtension != "part"
    }
  }

  private func isAuthorized(_ request: GCDWebServerRequest) -> Bool {
    guard let expectedToken = accessToken,
          let providedToken = request.query?["token"] as? String else {
      return false
    }
    return providedToken == expectedToken
  }

  private func validatedHttpUrl(_ rawValue: String) -> URL? {
    guard let url = URL(string: rawValue),
          let scheme = url.scheme?.lowercased(),
          (scheme == "http" || scheme == "https"),
          url.host?.isEmpty == false else {
      return nil
    }
    return url
  }

  private func getLocalIpAddress() -> String? {
    var address: String?
    var ifaddr: UnsafeMutablePointer<ifaddrs>?
    if getifaddrs(&ifaddr) == 0 {
      var ptr = ifaddr
      while ptr != nil {
        defer { ptr = ptr?.pointee.ifa_next }
        guard let interface = ptr?.pointee else { continue }
        let addrFamily = interface.ifa_addr.pointee.sa_family
        if addrFamily == UInt8(AF_INET) {
          let name = String(cString: interface.ifa_name)
          if name == "en0" {
            var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            getnameinfo(interface.ifa_addr, socklen_t(interface.ifa_addr.pointee.sa_len),
                        &hostname, socklen_t(hostname.count),
                        nil, socklen_t(0), NI_NUMERICHOST)
            address = String(cString: hostname)
          }
        }
      }
      freeifaddrs(ifaddr)
    }
    return address
  }

  public func definition() -> ModuleDefinition {
    Name("LocalVideoProxy")
    Events("onCacheProgress", "onMediaControl")

    AsyncFunction("setTvNotificationMode") {
      (_: String, _: String?, _: String?, _: Bool, promise: Promise) in
      promise.resolve(nil)
    }

    AsyncFunction("updateTvPlaybackState") {
      (_: Bool, _: Double, _: Double, promise: Promise) in
      promise.resolve(nil)
    }

    AsyncFunction("updateTvCacheProgress") {
      (_: Double, _: String, promise: Promise) in
      promise.resolve(nil)
    }

    AsyncFunction("startServer") { (port: Int, promise: Promise) in
      if self.webServer == nil {
        self.accessToken = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        self.webServer = GCDWebServer()

        for method in ["GET", "HEAD"] {
          self.webServer?.addHandler(
            forMethod: method,
            path: "/cache",
            request: GCDWebServerRequest.self,
            asyncProcessBlock: { request, completionBlock in
              guard self.isAuthorized(request) else {
                completionBlock(GCDWebServerDataResponse(statusCode: 401))
                return
              }
              guard let id = request.query?["id"] as? String,
                    let file = self.findCachedMedia(id: id),
                    let response = GCDWebServerFileResponse(
                      file: file.path,
                      byteRange: request.byteRange
                    ) else {
                completionBlock(GCDWebServerDataResponse(statusCode: 404))
                return
              }
              response.contentType = self.cachedContentType(for: file)
              response.setValue("bytes", forAdditionalHeader: "Accept-Ranges")
              response.setValue(
                "Streaming",
                forAdditionalHeader: "transferMode.dlna.org"
              )
              let conversionIndicator =
                file.pathExtension.lowercased() == "ts" ? "1" : "0"
              response.setValue(
                "DLNA.ORG_OP=01;DLNA.ORG_CI=\(conversionIndicator);" +
                  "DLNA.ORG_FLAGS=01700000000000000000000000000000",
                forAdditionalHeader: "contentFeatures.dlna.org"
              )
              completionBlock(response)
            }
          )
        }
        
        self.webServer?.addHandler(
          forMethod: "HEAD",
          path: "/stream.ts",
          request: GCDWebServerRequest.self,
          asyncProcessBlock: { request, completionBlock in
            guard self.isAuthorized(request) else {
              completionBlock(GCDWebServerDataResponse(statusCode: 401))
              return
            }
            guard let targetUrlStr = request.query?["url"] as? String,
                  self.validatedHttpUrl(targetUrlStr) != nil else {
              completionBlock(GCDWebServerDataResponse(statusCode: 400))
              return
            }
            let response = GCDWebServerDataResponse(statusCode: 200)
            response.contentType = "video/mp2t"
            response.setValue("Streaming", forAdditionalHeader: "transferMode.dlna.org")
            response.setValue(
              "DLNA.ORG_OP=00;DLNA.ORG_CI=1;" +
                "DLNA.ORG_FLAGS=01700000000000000000000000000000",
              forAdditionalHeader: "contentFeatures.dlna.org"
            )
            completionBlock(response)
          }
        )

        // Handler pour le MPEG-TS Stitching
        self.webServer?.addHandler(forMethod: "GET", path: "/stream.ts", request: GCDWebServerRequest.self, asyncProcessBlock: { request, completionBlock in
          guard self.isAuthorized(request) else {
            completionBlock(GCDWebServerDataResponse(statusCode: 401))
            return
          }
          guard let targetUrlStr = request.query?["url"] as? String,
                self.validatedHttpUrl(targetUrlStr) != nil else {
            completionBlock(GCDWebServerDataResponse(statusCode: 400))
            return
          }
          let referer = request.query?["referer"] as? String
          let origin = request.query?["origin"] as? String
          let requestedUserAgent = request.query?["userAgent"] as? String
          let userAgent = requestedUserAgent.flatMap {
              $0.isEmpty || $0.count > 512 ? nil : $0
          } ?? "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15"
          
          let stitcher = HlsStitcher()
          self.activeStitchers.removeAll { $0.isFinished }
          self.activeStitchers.append(stitcher)
          
          stitcher.fetchM3u8(
            urlStr: targetUrlStr,
            referer: referer,
            origin: origin,
            userAgent: userAgent
          ) { success in
              if success {
                  stitcher.startStreaming(responseBlock: completionBlock)
              } else {
                  completionBlock(GCDWebServerDataResponse(statusCode: 500))
                  self.activeStitchers.removeAll { $0 === stitcher }
              }
          }
        })

        self.webServer?.addHandler(
          forMethod: "HEAD",
          path: "/proxy",
          request: GCDWebServerRequest.self,
          asyncProcessBlock: { request, completionBlock in
            guard self.isAuthorized(request) else {
              completionBlock(GCDWebServerDataResponse(statusCode: 401))
              return
            }
            guard let targetUrlStr = request.query?["url"] as? String,
                  let targetUrl = self.validatedHttpUrl(targetUrlStr) else {
              completionBlock(GCDWebServerDataResponse(statusCode: 400))
              return
            }
            let response = GCDWebServerDataResponse(statusCode: 200)
            response.contentType = self.directContentType(for: targetUrl)
            response.setValue("bytes", forAdditionalHeader: "Accept-Ranges")
            response.setValue("Streaming", forAdditionalHeader: "transferMode.dlna.org")
            response.setValue(
              "DLNA.ORG_OP=01;DLNA.ORG_CI=0;" +
                "DLNA.ORG_FLAGS=01700000000000000000000000000000",
              forAdditionalHeader: "contentFeatures.dlna.org"
            )
            completionBlock(response)
          }
        )

        // Handler pour le Proxy Classique
        self.webServer?.addHandler(forMethod: "GET", path: "/proxy", request: GCDWebServerRequest.self, asyncProcessBlock: { request, completionBlock in
          guard self.isAuthorized(request) else {
            completionBlock(GCDWebServerDataResponse(statusCode: 401))
            return
          }
          guard let targetUrlStr = request.query?["url"] as? String,
                let targetUrl = self.validatedHttpUrl(targetUrlStr) else {
            completionBlock(GCDWebServerDataResponse(statusCode: 400))
            return
          }
          let referer = request.query?["referer"] as? String
          let origin = request.query?["origin"] as? String
          let requestedUserAgent = request.query?["userAgent"] as? String
          let userAgent = requestedUserAgent.flatMap {
              $0.isEmpty || $0.count > 512 ? nil : $0
          } ?? "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15"
          
          var urlRequest = URLRequest(url: targetUrl)
          urlRequest.httpMethod = "GET"
          urlRequest.timeoutInterval = 20
          urlRequest.setValue(userAgent, forHTTPHeaderField: "User-Agent")
          if let ref = referer, !ref.isEmpty {
              urlRequest.setValue(ref, forHTTPHeaderField: "Referer")
          }
          if let origin = origin, !origin.isEmpty {
              urlRequest.setValue(origin, forHTTPHeaderField: "Origin")
          }
          if let range = request.headers["Range"] as? String {
              urlRequest.setValue(range, forHTTPHeaderField: "Range")
          }

          let config = URLSessionConfiguration.default
          config.timeoutIntervalForRequest = 20
          config.timeoutIntervalForResource = 60
          let streamer = ProxyStreamer()
          streamer.responseBlock = completionBlock
          
          let session = URLSession(configuration: config, delegate: streamer, delegateQueue: nil)
          let task = session.dataTask(with: urlRequest)
          streamer.task = task
          
          self.activeStreamers.append(streamer)
          self.activeStreamers.removeAll { $0.isFinished }
          
          task.resume()
        })
        
        self.webServer?.start(withPort: UInt(port), bonjourName: nil)
      }
      
      let ip = self.getLocalIpAddress() ?? "127.0.0.1"
      promise.resolve([
        "ip": ip,
        "token": self.accessToken ?? ""
      ])
    }

    AsyncFunction("stopServer") { (promise: Promise) in
      self.webServer?.stop()
      self.webServer = nil
      self.accessToken = nil
      self.activeStreamers.removeAll()
      self.activeStitchers.removeAll()
      promise.resolve(nil)
    }

    AsyncFunction("getLastError") { (promise: Promise) in
      promise.resolve(nil)
    }

    AsyncFunction("cacheMedia") {
      (
        url: String,
        format: String,
        referer: String?,
        origin: String?,
        requestedUserAgent: String?,
        requestedMaxHeight: Int?,
        dlnaOptions: [String: String]?,
        promise: Promise
      ) in
      self.cacheStateLock.lock()
      if self.isCacheBusy {
        self.cacheStateLock.unlock()
        promise.reject(
          "ERR_CACHE_BUSY",
          "Another media download is already running"
        )
        return
      }
      self.isCacheBusy = true
      self.cacheWasCancelled = false
      self.cacheStateLock.unlock()

      guard self.webServer != nil else {
        self.cacheStateLock.lock()
        self.isCacheBusy = false
        self.cacheStateLock.unlock()
        promise.reject(
          "ERR_SERVER_NOT_STARTED",
          "Local video server must be started before caching"
        )
        return
      }
      guard self.validatedHttpUrl(url) != nil else {
        self.cacheStateLock.lock()
        self.isCacheBusy = false
        self.cacheStateLock.unlock()
        promise.reject("ERR_CACHE_URL", "Invalid media URL")
        return
      }

      do {
        let directory = try self.cacheDirectory()
        let freeSpace = try directory.resourceValues(
          forKeys: [.volumeAvailableCapacityForImportantUsageKey]
        ).volumeAvailableCapacityForImportantUsage ?? 0
        guard freeSpace > 100 * 1024 * 1024 else {
          throw NSError(
            domain: "HorusMediaCache",
            code: 4,
            userInfo: [NSLocalizedDescriptionKey: "Not enough free space"]
          )
        }

        let cacheId = UUID().uuidString
          .replacingOccurrences(of: "-", with: "")
          .lowercased()
        let partialFile = directory.appendingPathComponent("\(cacheId).part")
        let isHls = format.lowercased() == "hls"
        let userAgent = requestedUserAgent.flatMap {
          $0.isEmpty || $0.count > 512 ? nil : $0
        } ?? "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15"

        let finish: (Bool, String, Int64, Error?) -> Void = {
          success,
          contentType,
          sizeBytes,
          error in
          self.cacheStateLock.lock()
          let wasCancelled = self.cacheWasCancelled
          self.isCacheBusy = false
          self.activeCacheDownloader = nil
          self.activeCacheStitcher = nil
          self.cacheStateLock.unlock()

          guard success, sizeBytes > 0 else {
            try? FileManager.default.removeItem(at: partialFile)
            promise.reject(
              wasCancelled ? "ERR_CACHE_CANCELLED" : "ERR_CACHE_DOWNLOAD",
              error?.localizedDescription ?? "Media download failed"
            )
            return
          }

          let extensionName = self.cachedExtension(
            contentType: contentType,
            isHls: isHls
          )
          let finalFile = directory.appendingPathComponent(
            "\(cacheId).\(extensionName)"
          )
          do {
            try FileManager.default.moveItem(at: partialFile, to: finalFile)
            self.sendEvent("onCacheProgress", [
              "bytesDownloaded": Double(sizeBytes),
              "totalBytes": Double(sizeBytes)
            ])
            var result: [String: Any] = [
              "id": cacheId,
              "contentType": contentType,
              "sizeBytes": Double(sizeBytes),
              "seekable": contentType.lowercased() == "video/mp4",
              "dlnaStarted": false
            ]
            if isHls {
              result["fallbackReason"] = "La conversion MP4 n’est pas disponible sur iOS."
            }
            promise.resolve(result)
          } catch {
            try? FileManager.default.removeItem(at: partialFile)
            try? FileManager.default.removeItem(at: finalFile)
            promise.reject(
              "ERR_CACHE_FINALIZE",
              "Could not finalize cached media: \(error.localizedDescription)"
            )
          }
        }

        if isHls {
          let stitcher = HlsStitcher()
          self.activeCacheStitcher = stitcher
          stitcher.cacheToFile(
            urlStr: url,
            referer: referer,
            origin: origin,
            userAgent: userAgent,
            maxHeight: requestedMaxHeight ?? 720,
            destination: partialFile,
            progress: { downloadedBytes in
              self.sendEvent("onCacheProgress", [
                "bytesDownloaded": Double(downloadedBytes)
              ])
            },
            completion: { success, sizeBytes, error in
              finish(success, "video/mp2t", sizeBytes, error)
            }
          )
        } else {
          guard let targetUrl = URL(string: url) else {
            finish(false, "video/mp4", 0, nil)
            return
          }
          var request = URLRequest(url: targetUrl)
          request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
          if let referer = referer {
            request.setValue(referer, forHTTPHeaderField: "Referer")
          }
          if let origin = origin {
            request.setValue(origin, forHTTPHeaderField: "Origin")
          }
          let downloader = DirectCacheDownloader(
            destination: partialFile,
            progress: { downloadedBytes, totalBytes in
              var event: [String: Any?] = [
                "bytesDownloaded": Double(downloadedBytes)
              ]
              if let totalBytes = totalBytes {
                event["totalBytes"] = Double(totalBytes)
              }
              self.sendEvent("onCacheProgress", event)
            },
            completion: finish
          )
          self.activeCacheDownloader = downloader
          do {
            try downloader.start(request: request)
          } catch {
            finish(false, "video/mp4", 0, error)
          }
        }
      } catch {
        self.cacheStateLock.lock()
        self.isCacheBusy = false
        self.cacheStateLock.unlock()
        promise.reject("ERR_CACHE_DOWNLOAD", error.localizedDescription)
      }
    }

    AsyncFunction("cancelCache") { (promise: Promise) in
      self.cacheStateLock.lock()
      self.cacheWasCancelled = true
      let downloader = self.activeCacheDownloader
      let stitcher = self.activeCacheStitcher
      self.cacheStateLock.unlock()
      downloader?.cancel()
      stitcher?.cancelCaching()
      promise.resolve(nil)
    }

    AsyncFunction("removeCachedMedia") { (id: String, promise: Promise) in
      if let file = self.findCachedMedia(id: id) {
        try? FileManager.default.removeItem(at: file)
      }
      promise.resolve(nil)
    }

    AsyncFunction("clearCache") { (promise: Promise) in
      self.cacheStateLock.lock()
      let isBusy = self.isCacheBusy
      self.cacheStateLock.unlock()
      if isBusy {
        promise.reject(
          "ERR_CACHE_BUSY",
          "Cannot clear cache while a download is running"
        )
        return
      }
      do {
        try self.clearCacheDirectory()
        promise.resolve(nil)
      } catch {
        promise.reject(
          "ERR_CACHE_CLEAR",
          "Could not clear media cache: \(error.localizedDescription)"
        )
      }
    }
  }
}
