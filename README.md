
# 3. Start development server
docker-compose -f docker-compose.dev.yml up --build

# Access at: http://localhost:3000
```

### Production Mode
```bash
# 1. Set your API key
export GEMINI_API_KEY=your_key_here

# 2. Build and run
docker-compose up --build -d

# Access at: http://localhost:4173
```

**See [DOCKER.md](DOCKER.md) for advanced usage, troubleshooting, and deployment guides.**

---

## 🖥️ Run Locally (Without Docker)

**Prerequisites:** Node.js 18+

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set the `GEMINI_API_KEY`:
   ```bash
   cp env.example .env.local
   # Edit .env.local and add your key
   ```

3. Run the app:
   ```bash
   npm run dev
   ```
   Access at: http://localhost:3000

---

## 📚 Documentation

- **[DOCKER.md](DOCKER.md)** - Complete Docker deployment guide
- Architecture: Two-step workflow (Dataroom Analysis → Report Generation)
- 49 document types supported (PDFs, Excel files)

---

## ⚠️ Security Note

**Current Setup:** Backend proxy with JWT authentication implemented.

### ✅ Security Implemented:
- API key on backend only (not client-side)
- JWT authentication with password hashing (bcrypt)
- Usage caps and cost tracking
- Authorized email whitelist
- Audit logging to CloudWatch
- Per-user authentication and authorization

### ❌ Outstanding Security Vulnerabilities:

1. **No HTTPS/SSL** - Running on HTTP only
3. **Database credentials in plain text** - Stored in config files
4. **JWT tokens can't be revoked** - No session management/blacklist
5. **No rate limiting** - Only usage caps, no per-endpoint throttling
6. **No brute force protection** - Unlimited login attempts
7. **No input validation** - File size/type not enforced
8. **XSS risk** - AI-generated content not sanitized
9. **Long-lived JWT tokens** - No refresh token mechanism (24hr expiry)
10. **CORS not configured** - May allow unwanted origins
11. **No CSRF protection** - State-changing requests vulnerable
12. **No secure headers** - Missing CSP, X-Frame-Options, etc.
13. **Secrets management** - Should use AWS Secrets Manager in production
14. **No malware scanning** - Uploaded files not scanned
