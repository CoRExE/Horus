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
    
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        if let httpResponse = response as? HTTPURLResponse {
            let serverResponse = GCDWebServerStreamedResponse(contentType: httpResponse.mimeType ?? "video/mp4", asyncStreamBlock: { [weak self] completion in
                DispatchQueue.global().async {
                    guard let self = self else { completion(Data(), nil); return }
                    while self.dataQueue.isEmpty && !self.isFinished {
                        self.semaphore.wait()
                    }
                    if !self.dataQueue.isEmpty {
                        let data = self.dataQueue.removeFirst()
                        completion(data, nil)
                    } else {
                        completion(Data(), self.error)
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
        self.dataQueue.append(data)
        self.semaphore.signal()
    }
    
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        self.error = error
        self.isFinished = true
        self.semaphore.signal()
    }
}

class HlsStitcher: NSObject, URLSessionDataDelegate {
    var responseBlock: GCDWebServerCompletionBlock?
    var segments = [String]()
    var currentSegmentIndex = 0
    var dataQueue = [Data]()
    var isFinished = false
    var error: Error?
    let semaphore = DispatchSemaphore(value: 0)
    var session: URLSession!
    var userAgent: String = ""
    var referer: String?
    var origin: String?
    
    override init() {
        super.init()
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }
    
    private func resolvePlaylistUri(_ rawUri: String, relativeTo playlistUrl: URL) -> URL? {
        guard let resolved = URL(string: rawUri, relativeTo: playlistUrl)?.absoluteURL else {
            return nil
        }

        // Some CDNs sign a whole playlist in its query string while leaving
        // relative segment paths unsigned.
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

    func fetchM3u8(
        urlStr: String,
        referer: String?,
        origin: String?,
        userAgent: String,
        depth: Int = 0,
        completion: @escaping (Bool) -> Void
    ) {
        guard depth < 6 else { completion(false); return }
        self.userAgent = userAgent
        self.referer = referer
        self.origin = origin
        guard let url = URL(string: urlStr) else { completion(false); return }
        var req = URLRequest(url: url)
        req.timeoutInterval = 20
        req.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        if let ref = referer { req.setValue(ref, forHTTPHeaderField: "Referer") }
        if let origin = origin { req.setValue(origin, forHTTPHeaderField: "Origin") }
        
        URLSession.shared.dataTask(with: req) { data, response, err in
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode),
                  let data = data,
                  let text = String(data: data, encoding: .utf8) else {
                completion(false)
                return
            }
            
            var newSegments = [String]()
            var variants = [(bandwidth: Int64, url: String)]()
            var pendingVariantBandwidth: Int64?
            var unsupportedEncryption = false
            var usesFragmentedMp4 = false
            
            let lines = text.components(separatedBy: .newlines)
            for line in lines {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.hasPrefix("#EXT-X-STREAM-INF:") {
                    let attributes = String(trimmed.dropFirst("#EXT-X-STREAM-INF:".count))
                    let pattern = #"(?:^|,)BANDWIDTH=(\d+)"#
                    if let regex = try? NSRegularExpression(pattern: pattern),
                       let match = regex.firstMatch(
                        in: attributes,
                        range: NSRange(attributes.startIndex..., in: attributes)
                       ),
                       let range = Range(match.range(at: 1), in: attributes) {
                        pendingVariantBandwidth = Int64(attributes[range]) ?? 0
                    } else {
                        pendingVariantBandwidth = 0
                    }
                } else if trimmed.hasPrefix("#EXT-X-KEY:") && !trimmed.contains("METHOD=NONE") {
                    unsupportedEncryption = true
                } else if trimmed.hasPrefix("#EXT-X-MAP:") {
                    usesFragmentedMp4 = true
                } else if !trimmed.isEmpty && !trimmed.hasPrefix("#") {
                    guard let resolved = self.resolvePlaylistUri(trimmed, relativeTo: url) else {
                        continue
                    }
                    if let bandwidth = pendingVariantBandwidth {
                        variants.append((bandwidth, resolved.absoluteString))
                        pendingVariantBandwidth = nil
                    } else {
                        newSegments.append(resolved.absoluteString)
                    }
                }
            }
            
            if let selectedVariant = variants.max(by: { $0.bandwidth < $1.bandwidth }) {
                self.fetchM3u8(
                    urlStr: selectedVariant.url,
                    referer: referer,
                    origin: origin,
                    userAgent: userAgent,
                    depth: depth + 1,
                    completion: completion
                )
            } else {
                guard !unsupportedEncryption, !usesFragmentedMp4 else {
                    print("[Proxy] Unsupported encrypted or fragmented-MP4 HLS playlist")
                    completion(false)
                    return
                }
                self.segments = newSegments
                completion(!newSegments.isEmpty)
            }
        }.resume()
    }
    
    func startStreaming(responseBlock: @escaping GCDWebServerCompletionBlock) {
        self.responseBlock = responseBlock
        
        let serverResponse = GCDWebServerStreamedResponse(contentType: "video/mp2t", asyncStreamBlock: { [weak self] completion in
            DispatchQueue.global().async {
                guard let self = self else { completion(Data(), nil); return }
                while self.dataQueue.isEmpty && !self.isFinished {
                    self.semaphore.wait()
                }
                if !self.dataQueue.isEmpty {
                    let data = self.dataQueue.removeFirst()
                    completion(data, nil)
                } else {
                    completion(Data(), self.error)
                }
            }
        })
        serverResponse.setValue("*", forAdditionalHeader: "Access-Control-Allow-Origin")
        serverResponse.setValue("Streaming", forAdditionalHeader: "transferMode.dlna.org")
        serverResponse.setValue(
            "DLNA.ORG_OP=00;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000",
            forAdditionalHeader: "contentFeatures.dlna.org"
        )
        responseBlock(serverResponse)
        
        downloadNextSegment()
    }
    
    func downloadNextSegment() {
        if currentSegmentIndex >= segments.count {
            isFinished = true
            semaphore.signal()
            return
        }
        let urlStr = segments[currentSegmentIndex]
        print("[Proxy] Pushing segment \(currentSegmentIndex + 1)/\(segments.count) to TV")
        guard let url = URL(string: urlStr) else {
            currentSegmentIndex += 1
            downloadNextSegment()
            return
        }
        var req = URLRequest(url: url)
        req.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        if let ref = referer { req.setValue(ref, forHTTPHeaderField: "Referer") }
        if let origin = origin { req.setValue(origin, forHTTPHeaderField: "Origin") }
        
        session.dataTask(with: req).resume()
    }
    
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        completionHandler(.allow)
    }
    
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        dataQueue.append(data)
        semaphore.signal()
    }
    
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        currentSegmentIndex += 1
        downloadNextSegment()
    }
}

public class LocalVideoProxyModule: Module {
  private var webServer: GCDWebServer?
  private var activeStreamers = [ProxyStreamer]()
  private var activeStitchers = [HlsStitcher]()
  private var accessToken: String?

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

    AsyncFunction("startServer") { (port: Int, promise: Promise) in
      if self.webServer == nil {
        self.accessToken = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        self.webServer = GCDWebServer()
        
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
              }
          }
          
          self.activeStitchers.removeAll { $0.isFinished }
        })

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
  }
}
