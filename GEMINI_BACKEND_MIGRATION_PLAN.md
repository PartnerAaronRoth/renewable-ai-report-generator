# Implementation Plan: Move Gemini API to Backend Proxy

**Goal**: Remove Gemini API key from frontend and proxy all Gemini requests through the backend for security, authentication, and usage tracking.

**Estimated Time**: 4-6 hours total
**Risk Level**: Medium - requires frontend and backend changes with careful testing

---

## Overview

### Current State
- ❌ Frontend directly calls Google Gemini API using `@google/genai` npm package
- ❌ API key is baked into frontend JavaScript bundle at build time
- ❌ API key is semi-exposed (anyone can extract from network tab or decompiled JS)
- ✅ Backend has auth and usage tracking but frontend bypasses it

### Target State
- ✅ Frontend calls backend API endpoints only
- ✅ Backend proxies requests to Google Gemini API
- ✅ API key stored only on backend (environment variable)
- ✅ All requests authenticated and usage tracked
- ✅ Usage caps enforced

---

## Architecture Changes

### Before
```
Browser → @google/genai → Google Gemini API
(API key in browser memory)
```

### After
```
Browser → Backend API (JWT auth) → Google Gemini API
(API key only on server)
```

---

## Implementation Steps

## PHASE 1: Backend Implementation (2-3 hours)

### Step 1.1: Complete Backend Gemini Proxy Endpoints

**File**: `/backend/gemini_api.py` (already started)

Add the following endpoints (copy signatures from frontend `geminiService.ts`):

#### 1. `POST /api/gemini/classify-document`
- **Purpose**: Classify and analyze documents
- **Request**:
  ```python
  class ClassifyDocumentRequest(BaseModel):
      fileName: str
      projectName: str
      textContent: Optional[str] = None
      model: str = "gemini-2.0-flash-exp"
      fileData: Optional[str] = None  # base64 encoded PDF
  ```
- **Response**:
  ```python
  class AnalysisResult(BaseModel):
      documentTypes: List[str]
      title: str
      date: str
      summary: str
      tokenCount: int
  ```
- **Implementation notes**:
  - Handle both text content and file uploads
  - For files: decode base64, pass to Gemini with inlineData
  - Use `SOURCE_TYPE_DEFINITIONS_PROMPT` (copy from frontend constants)
  - Return JSON with responseMimeType: "application/json"
  - Include retry logic with exponential backoff (5 attempts)
  - Track usage and costs

#### 2. `POST /api/gemini/generate-project-summary`
- **Purpose**: Generate executive summary from inventory
- **Request**:
  ```python
  class ProjectSummaryRequest(BaseModel):
      inventory: List[dict]  # List of InventoryItem objects
      projectName: str
      model: str = "gemini-2.0-flash-exp"
  ```
- **Response**: `{"summary": str, "usage": dict, "cost": dict}`
- **Implementation**: Filter inventory, create context, call Gemini with prompt

#### 3. `POST /api/gemini/analyze-report-section`
- **Purpose**: Analyze report section with document context
- **Request**:
  ```python
  class AnalyzeReportSectionRequest(BaseModel):
      sectionTitle: str
      subsectionTitle: str
      rows: List[DataEntryRow]
      inventory: List[dict]
      processedFiles: List[dict]  # {fileName, blob as base64}
      proposalContext: str
      config: dict  # {stage, level}
      userPrompt: Optional[str] = None
      forcedFileIds: Optional[List[str]] = None
      model: str = "gemini-2.5-pro"
  ```
- **Response**: 
  ```python
  {
    "filledRows": List[DataEntryRow],
    "content": str
  }
  ```
- **Implementation notes**:
  - Most complex endpoint
  - Handle file relevance identification
  - Attach PDFs as inlineData
  - Use Google Search tool: `tools=[{"googleSearch": {}}]`
  - Parse JSON response with repair logic
  - Handle table generation with placeholder injection

#### 4. `POST /api/gemini/regenerate-narrative`
- **Purpose**: Regenerate narrative from existing data rows
- **Request**: See `RegenerateNarrativeRequest` model
- **Response**: `{"content": str, "usage": dict, "cost": dict}`
- **Implementation**: Use rows as source of truth, no file search

#### 5. `POST /api/gemini/generate-conclusion`
- **Purpose**: Generate section conclusion with risks
- **Request**: See `GenerateConclusionRequest` model
- **Response**: `{"conclusion": str, "usage": dict, "cost": dict}`

#### 6. `POST /api/gemini/generate-executive-summary`
- **Purpose**: Generate executive summary with risk definitions
- **Request**: See `GenerateExecutiveSummaryRequest` model
- **Response**: `{"summary": str, "usage": dict, "cost": dict}`

#### 7. `POST /api/gemini/generate-table-summary`
- **Purpose**: Generate summary for table cell (max 100 words)
- **Request**: See `GenerateTableSummaryRequest` model
- **Response**: `{"summary": str, "usage": dict, "cost": dict}`

### Step 1.2: Update `/backend/main.py`

Add to imports:
```python
from gemini_api import (
    list_models, analyze_pdf, extract_pdf_text,
    classify_document_endpoint, generate_project_summary,
    analyze_report_section, regenerate_narrative,
    generate_conclusion, generate_executive_summary,
    generate_table_summary
)
```

Add to route_handlers in Litestar app:
```python
app = Litestar(
    route_handlers=[
        # ... existing handlers ...
        # Gemini proxy endpoints
        list_models, analyze_pdf, extract_pdf_text,
        classify_document_endpoint, generate_project_summary,
        analyze_report_section, regenerate_narrative,
        generate_conclusion, generate_executive_summary,
        generate_table_summary,
        serve_spa  # Must be last
    ],
    on_startup=[on_startup],
)
```

### Step 1.3: Update Backend Dependencies

**File**: `/backend/environment.yml`

Ensure you have:
```yaml
- python=3.11
- uvicorn=0.34.0
- pip
- pip:
  - litestar[standard]==2.12.1
  - google-genai==1.11.0
```

### Step 1.4: Copy Constants to Backend

**File**: `/backend/constants.py` (create new)

Copy `SOURCE_TYPE_DEFINITIONS_PROMPT` from `/constants/index.ts`:
```python
SOURCE_TYPE_DEFINITIONS_PROMPT = """
[Copy the full prompt text from frontend]
"""
```

---

## PHASE 2: Frontend Implementation (2-3 hours)

### Step 2.1: Create API Client Service

**File**: `/services/apiClient.ts` (create new)

```typescript
const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:8000';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: string
  ) {
    super(message);
  }
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem('auth_token');
  
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(
      error.detail || 'API request failed',
      response.status,
      error.detail
    );
  }

  return response.json();
}
```

### Step 2.2: Rewrite `geminiService.ts`

**File**: `/services/geminiService.ts`

Replace ALL functions to call backend APIs instead of Google directly:

```typescript
import { apiRequest } from './apiClient';
import { AnalysisResult, /* ... other types */ } from '../types';

// Remove these imports:
// import { GoogleGenAI } from "@google/genai";

// Remove getAiClient() function entirely

export const DEFAULT_BULK_MODEL = "gemini-3-flash-preview"; 
export const DEFAULT_REASONING_MODEL = "gemini-2.5-pro";

export const KNOWN_MODELS = [/* ... keep list ... */];

export const fetchAvailableModels = async (): Promise<string[]> => {
  try {
    const response = await apiRequest<{models: string[]}>('/api/gemini/models');
    return response.models;
  } catch (error) {
    console.warn("Failed to fetch models, using fallback", error);
    return KNOWN_MODELS;
  }
};

const blobToBase64 = (blob: Blob): Promise<string> => {
  // Keep this helper function as-is
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export const analyzePdfChunk = async (
  blob: Blob,
  modelId: string = DEFAULT_BULK_MODEL
): Promise<string> => {
  const base64Data = await blobToBase64(blob);
  
  const response = await apiRequest<{summary: string}>('/api/gemini/analyze-pdf', {
    method: 'POST',
    body: JSON.stringify({
      fileData: base64Data,
      model: modelId,
    }),
  });
  
  return response.summary;
};

export const extractTextFromPdf = async (
  blob: Blob,
  modelId: string = DEFAULT_BULK_MODEL
): Promise<string> => {
  if (!blob || blob.size === 0) {
    console.warn("Skipping text extraction: Empty file.");
    return "";
  }
  
  const base64Data = await blobToBase64(blob);
  
  try {
    const response = await apiRequest<{text: string}>('/api/gemini/extract-pdf-text', {
      method: 'POST',
      body: JSON.stringify({
        fileData: base64Data,
        model: modelId,
      }),
    });
    return response.text;
  } catch (error: any) {
    console.error("PDF Text Extraction Failed", error);
    return "";
  }
};

export const classifyAndAnalyzeDocument = async (
  blob: Blob,
  fileName: string,
  projectName: string,
  textContent?: string,
  modelId: string = DEFAULT_BULK_MODEL
): Promise<AnalysisResult> => {
  let fileData: string | undefined;
  
  if (!textContent) {
    fileData = await blobToBase64(blob);
  }
  
  const response = await apiRequest<AnalysisResult>('/api/gemini/classify-document', {
    method: 'POST',
    body: JSON.stringify({
      fileName,
      projectName,
      textContent,
      fileData,
      model: modelId,
    }),
  });
  
  return response;
};

export const generateProjectSummary = async (
  inventory: InventoryItem[],
  projectName: string,
  modelId: string = DEFAULT_BULK_MODEL
): Promise<string> => {
  const response = await apiRequest<{summary: string}>('/api/gemini/generate-project-summary', {
    method: 'POST',
    body: JSON.stringify({
      inventory,
      projectName,
      model: modelId,
    }),
  });
  
  return response.summary;
};

export const analyzeReportSection = async (
  sectionTitle: string,
  subsectionTitle: string,
  rows: DataEntryRow[],
  inventory: InventoryItem[],
  processedFiles: ProcessedFile[],
  proposalContext: string,
  config: { stage: ProjectStage, level: ReportLevel },
  userPrompt?: string,
  forcedFileIds?: string[],
  logger?: (msg: string, type?: 'info'|'error'|'success') => void,
  modelId: string = DEFAULT_REASONING_MODEL
): Promise<{ filledRows: DataEntryRow[], content: string }> => {
  
  // Convert processedFiles blobs to base64
  const filesWithBase64 = await Promise.all(
    processedFiles.map(async (file) => ({
      fileName: file.fileName,
      blobData: await blobToBase64(file.blob),
    }))
  );
  
  const response = await apiRequest<{filledRows: DataEntryRow[], content: string}>(
    '/api/gemini/analyze-report-section',
    {
      method: 'POST',
      body: JSON.stringify({
        sectionTitle,
        subsectionTitle,
        rows,
        inventory,
        processedFiles: filesWithBase64,
        proposalContext,
        config,
        userPrompt,
        forcedFileIds,
        model: modelId,
      }),
    }
  );
  
  return response;
};

export const regenerateNarrativeFromRows = async (
  subsectionTitle: string,
  rows: DataEntryRow[],
  config: { stage: ProjectStage, level: ReportLevel },
  modelId: string = DEFAULT_REASONING_MODEL
): Promise<string> => {
  const response = await apiRequest<{content: string}>('/api/gemini/regenerate-narrative', {
    method: 'POST',
    body: JSON.stringify({
      subsectionTitle,
      rows,
      config,
      model: modelId,
    }),
  });
  
  return response.content;
};

export const generateSectionConclusion = async (
  sectionTitle: string,
  subsectionsContent: string,
  highRiskRows: DataEntryRow[],
  modelId: string = DEFAULT_REASONING_MODEL
): Promise<string> => {
  const response = await apiRequest<{conclusion: string}>('/api/gemini/generate-conclusion', {
    method: 'POST',
    body: JSON.stringify({
      sectionTitle,
      subsectionsContent,
      highRiskRows,
      model: modelId,
    }),
  });
  
  return response.conclusion;
};

export const generateExecutiveSummaryNarrative = async (
  proposalText: string,
  stage: ProjectStage,
  modelId: string = DEFAULT_REASONING_MODEL
): Promise<string> => {
  const response = await apiRequest<{summary: string}>('/api/gemini/generate-executive-summary', {
    method: 'POST',
    body: JSON.stringify({
      proposalText,
      stage,
      model: modelId,
    }),
  });
  
  return response.summary;
};

export const generateSectionSummaryForTable = async (
  sectionTitle: string,
  sectionContent: string,
  modelId: string = DEFAULT_BULK_MODEL
): Promise<string> => {
  const response = await apiRequest<{summary: string}>('/api/gemini/generate-table-summary', {
    method: 'POST',
    body: JSON.stringify({
      sectionTitle,
      sectionContent,
      model: modelId,
    }),
  });
  
  return response.summary;
};
```

### Step 2.3: Remove Google Gemini Dependencies

**File**: `/package.json`

Remove:
```json
"@google/genai": "^1.30.0",
```

**File**: `/index.html`

Remove the import map entry:
```html
"@google/genai": "https://aistudiocdn.com/@google/genai@^1.30.0",
```

**File**: `/vite.config.ts`

Remove these lines:
```typescript
define: {
  'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
  'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
},
```

**File**: `/Dockerfile`

Remove from frontend builder stage:
```dockerfile
ARG GEMINI_API_KEY
ENV GEMINI_API_KEY=$GEMINI_API_KEY
```

**File**: `/docker-compose.yml`

Remove from build args:
```yaml
args:
  GEMINI_API_KEY: ${GEMINI_API_KEY}
```

---

## PHASE 3: Authentication Integration (30 minutes)

### Step 3.1: Add Auth Context to Frontend

**File**: `/contexts/AuthContext.tsx` (create if doesn't exist)

```typescript
import React, { createContext, useContext, useState, useEffect } from 'react';

interface AuthContextType {
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => 
    localStorage.getItem('auth_token')
  );

  const login = (newToken: string) => {
    localStorage.setItem('auth_token', newToken);
    setToken(newToken);
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    setToken(null);
  };

  return (
    <AuthContext.Provider value={{
      token,
      login,
      logout,
      isAuthenticated: !!token
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
```

### Step 3.2: Add Login Component

**File**: `/components/Login.tsx` (create)

Simple login form that calls `/auth/login` endpoint and stores JWT token.

### Step 3.3: Protect Routes

Wrap main app with `<AuthProvider>` and check `isAuthenticated` before allowing access.

---

## PHASE 4: Testing (1-2 hours)

### Step 4.1: Backend Testing

1. **Start backend**:
   ```bash
   cd backend
   micromamba run -n backend uvicorn main:app --reload
   ```

2. **Test health check**:
   ```bash
   curl http://localhost:8000/health
   ```

3. **Test auth**:
   ```bash
   # Register
   curl -X POST http://localhost:8000/auth/register \
     -H "Content-Type: application/json" \
     -d '{"email":"test@partneresi.com","password":"test123"}'
   
   # Login
   curl -X POST http://localhost:8000/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test@partneresi.com","password":"test123"}'
   ```

4. **Test Gemini endpoints** (use JWT token from login):
   ```bash
   curl -X POST http://localhost:8000/api/gemini/models \
     -H "Authorization: Bearer YOUR_TOKEN_HERE"
   ```

### Step 4.2: Frontend Testing

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start dev server**:
   ```bash
   npm run dev
   ```

3. **Test workflow**:
   - Login with authorized email
   - Upload documents
   - Verify document classification works
   - Generate report
   - Check network tab - should see calls to `/api/gemini/*` not Google directly

### Step 4.3: Integration Testing

1. **Build production**:
   ```bash
   docker-compose build
   docker-compose up
   ```

2. **Verify**:
   - No GEMINI_API_KEY in browser console or network requests
   - All Gemini calls go through backend
   - Usage tracking works
   - Cost calculation works
   - Usage caps enforce correctly

---

## PHASE 5: Cleanup & Documentation

### Step 5.1: Update Documentation

**File**: `/README.md`

Update setup instructions:
- Remove frontend API key setup
- Add backend API key setup only
- Add auth setup instructions

**File**: `/DOCKER.md`

Update:
- Remove GEMINI_API_KEY from frontend build args
- Keep only in backend environment
- Add auth configuration

### Step 5.2: Update .env.example

```bash
# Backend API Keys
GEMINI_API_KEY=your_gemini_api_key_here

# Auth
JWT_SECRET=your_random_secret_here_at_least_32_chars

# Database (optional)
DATABASE_URL=sqlite:///./app.db

# AWS SES (optional, for password reset)
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# AWS_REGION=us-east-1
# SES_SENDER_EMAIL=no-reply@yourdomain.com

# MySQL (optional, for usage tracking)
# MYSQL_HOST=localhost
# MYSQL_PORT=3306
# MYSQL_DATABASE=renewable_ai_usage
# MYSQL_USER=root
# MYSQL_PASSWORD=
```

---

## Rollback Plan

If issues arise, revert by:

1. **Restore frontend Gemini calls**:
   ```bash
   git checkout HEAD -- services/geminiService.ts
   git checkout HEAD -- package.json
   git checkout HEAD -- vite.config.ts
   git checkout HEAD -- Dockerfile
   ```

2. **Reinstall @google/genai**:
   ```bash
   npm install @google/genai@^1.30.0
   ```

3. **Restore build args in docker-compose.yml**

---

## Common Issues & Solutions

### Issue: "Missing authorization header"
**Solution**: Ensure frontend sends JWT token in Authorization header for all `/api/*` requests

### Issue: "Usage limit exceeded" immediately
**Solution**: Check `config.yml` - set `enabled: false` for testing or increase `limit_usd`

### Issue: File upload fails / "413 Request Entity Too Large"
**Solution**: Increase Litestar request size limit:
```python
app = Litestar(
    request_max_body_size=50_000_000,  # 50MB
    # ...
)
```

### Issue: CORS errors in development
**Solution**: Add CORS middleware to backend:
```python
from litestar.config.cors import CORSConfig

cors_config = CORSConfig(
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
)

app = Litestar(
    cors_config=cors_config,
    # ...
)
```

---

## Success Criteria

✅ No `@google/genai` in frontend dependencies  
✅ No GEMINI_API_KEY in frontend code or build  
✅ All document operations work through backend API  
✅ JWT authentication required for all Gemini endpoints  
✅ Usage tracking captures all API calls  
✅ Usage caps enforce correctly  
✅ API key only stored in backend environment  
✅ Production Docker build succeeds  
✅ All existing features work (document upload, classification, report generation)  

---

## Timeline Estimate

| Phase | Time | Notes |
|-------|------|-------|
| Backend Endpoints | 2-3 hours | Most complex - handle files, structured outputs |
| Frontend Rewrite | 2 hours | Straightforward API calls |
| Auth Integration | 30 min | If auth already exists |
| Testing | 1-2 hours | Both manual and integration |
| Documentation | 30 min | Update README, DOCKER.md |
| **Total** | **6-8 hours** | Can be split across multiple sessions |

---

## Next Steps

When ready to implement:

1. Create a new branch: `git checkout -b feature/backend-gemini-proxy`
2. Follow phases in order
3. Commit after each phase for easy rollback
4. Test thoroughly before merging to main
5. Deploy to staging first if available

---

**Last Updated**: Current session  
**Prepared By**: AI Assistant  
**Project**: Renewable AI Report Generator
