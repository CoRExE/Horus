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
    
    override init() {
        super.init()
        let config = URLSessionConfiguration.default
        self.session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }
    
    func fetchM3u8(urlStr: String, referer: String?, userAgent: String, completion: @escaping (Bool) -> Void) {
        self.userAgent = userAgent
        self.referer = referer
        guard let url = URL(string: urlStr) else { completion(false); return }
        var req = URLRequest(url: url)
        req.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        if let ref = referer { req.setValue(ref, forHTTPHeaderField: "Referer") }
        
        URLSession.shared.dataTask(with: req) { data, response, err in
            guard let data = data, let text = String(data: data, encoding: .utf8) else { completion(false); return }
            
            var baseUrl = urlStr
            if let qIdx = baseUrl.firstIndex(of: "?") { baseUrl = String(baseUrl[..<qIdx]) }
            let basePath = (baseUrl as NSString).deletingLastPathComponent + "/"
            
            var isMaster = false
            var newSegments = [String]()
            
            let lines = text.components(separatedBy: .newlines)
            for line in lines {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.hasPrefix("#EXT-X-STREAM-INF:") {
                    isMaster = true
                } else if !trimmed.isEmpty && !trimmed.hasPrefix("#") {
                    if trimmed.hasPrefix("http") {
                        newSegments.append(trimmed)
                    } else if trimmed.hasPrefix("/") {
                        if let u = URL(string: urlStr), let scheme = u.scheme, let host = u.host {
                            let portStr = u.port != nil ? ":\(u.port!)" : ""
                            newSegments.append("\(scheme)://\(host)\(portStr)\(trimmed)")
                        }
                    } else {
                        newSegments.append(basePath + trimmed)
                    }
                }
            }
            
            if isMaster && !newSegments.isEmpty {
                self.fetchM3u8(urlStr: newSegments.last!, referer: referer, userAgent: userAgent, completion: completion)
            } else {
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
        self.webServer = GCDWebServer()
        
        // Handler pour le MPEG-TS Stitching
        self.webServer?.addHandler(forMethod: "GET", path: "/stream.ts", request: GCDWebServerRequest.self, asyncProcessBlock: { request, completionBlock in
          guard let urlString = request.query?["url"] as? String,
                let targetUrlStr = urlString.removingPercentEncoding else {
            completionBlock(GCDWebServerDataResponse(statusCode: 400))
            return
          }
          let referer = (request.query?["referer"] as? String)?.removingPercentEncoding
          let userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15"
          
          let stitcher = HlsStitcher()
          self.activeStitchers.append(stitcher)
          
          stitcher.fetchM3u8(urlStr: targetUrlStr, referer: referer, userAgent: userAgent) { success in
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
          guard let urlString = request.query?["url"] as? String,
                let targetUrlStr = urlString.removingPercentEncoding,
                let targetUrl = URL(string: targetUrlStr) else {
            completionBlock(GCDWebServerDataResponse(statusCode: 400))
            return
          }
          let referer = (request.query?["referer"] as? String)?.removingPercentEncoding
          
          var urlRequest = URLRequest(url: targetUrl)
          urlRequest.httpMethod = "GET"
          urlRequest.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15", forHTTPHeaderField: "User-Agent")
          if let ref = referer, !ref.isEmpty {
              urlRequest.setValue(ref, forHTTPHeaderField: "Referer")
          }
          if let range = request.headers["Range"] as? String {
              urlRequest.setValue(range, forHTTPHeaderField: "Range")
          }

          let config = URLSessionConfiguration.default
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
      promise.resolve(ip)
    }

    AsyncFunction("stopServer") { (promise: Promise) in
      self.webServer?.stop()
      self.webServer = nil
      self.activeStreamers.removeAll()
      self.activeStitchers.removeAll()
      promise.resolve(nil)
    }
  }
}
