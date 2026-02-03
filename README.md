
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

**Current Setup:** API key is client-side exposed (temporary for v1.0)  
**Roadmap:** Backend proxy with server-side API key, authentication, rate limiting, and cost tracking planned for v2.0
