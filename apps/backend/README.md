# Remorai Backend

NestJS backend service for the Remorai application.

## Extraction Performance Tuning

The extraction pipeline supports runtime performance tuning via environment variables. No code changes or redeployment needed—just restart the backend service after updating these variables.

### Environment Variables

#### Extraction Concurrency & Batching

##### `EXTRACT_PAGE_CONCURRENCY` (default: 4)

Controls how many PDF pages are processed simultaneously.

**Tuning:**

- **Lower (1-2)**: Use if hitting rate limits or memory constraints
- **Default (4)**: Balanced for most scenarios
- **Higher (6-12)**: Maximum speed with high API rate limits and sufficient memory

**Example:**

```bash
EXTRACT_PAGE_CONCURRENCY=8  # Process 8 pages at once
```

**Trade-offs:**

- ✅ Higher = faster extraction
- ⚠️ Higher = more memory usage, higher chance of rate limits
- ⚠️ Too high may cause API throttling

---

##### `OCR_TEXT_THRESHOLD` (default: 400)

Minimum OCR text length (characters) to use text-only extraction instead of vision.

**Tuning:**

- **Lower (200-300)**: More aggressive text-only extraction (faster, cheaper)
- **Default (400)**: Balanced
- **Higher (600-1000)**: More conservative, uses vision more often (better accuracy for visual content)

**Example:**

```bash
OCR_TEXT_THRESHOLD=300  # Use text-only for pages with 300+ chars
```

**Trade-offs:**

- ✅ Lower = faster, cheaper
- ⚠️ Lower = may miss visual-only information
- ✅ Higher = better accuracy for diagrams/tables
- ⚠️ Higher = slower, more expensive

---

##### `EXTRACT_FLUSH_BATCH_SIZE` (default: 10)

How many extraction results to buffer before writing to database.

**Tuning:**

- **Lower (5)**: Results appear in UI faster, more frequent DB writes
- **Default (10)**: Balanced
- **Higher (20-50)**: Fewer DB round-trips, better throughput (use for large documents)

**Example:**

```bash
EXTRACT_FLUSH_BATCH_SIZE=25  # Write every 25 results
```

**Trade-offs:**

- ✅ Higher = fewer DB writes, better throughput
- ⚠️ Higher = results take longer to appear in UI
- ⚠️ Higher = more memory usage

---

#### LLM API Configuration

##### `LLM_TIMEOUT_MS` (default: 45000)

Maximum time (milliseconds) to wait for LLM API responses.

**Tuning:**

- **Lower (30000-35000)**: Fail faster on slow requests
- **Default (45000)**: Balanced
- **Higher (60000-90000)**: More patient for complex documents

**Example:**

```bash
LLM_TIMEOUT_MS=35000  # 35 second timeout
```

**Trade-offs:**

- ✅ Lower = faster failure detection, quicker retries
- ⚠️ Lower = may timeout legitimate slow responses
- ✅ Higher = handles complex pages better
- ⚠️ Higher = slower to detect real failures

---

##### `LLM_MAX_OUTPUT_TOKENS_PRIMARY` (default: 2048)

Maximum tokens the LLM can generate per response.

**Tuning:**

- **Lower (1024-1536)**: Faster responses, cheaper (good for simple documents)
- **Default (2048)**: Balanced
- **Higher (3072-4096)**: Handle dense pages better (more materials per page)

**Example:**

```bash
LLM_MAX_OUTPUT_TOKENS_PRIMARY=1536  # Limit to 1536 tokens
```

**Trade-offs:**

- ✅ Lower = faster, cheaper
- ⚠️ Lower = may truncate results on dense pages
- ✅ Higher = handles dense pages completely
- ⚠️ Higher = slower, more expensive

---

##### `LLM_TEMPERATURE` (default: 0.2)

Controls LLM creativity/randomness (0 = deterministic, 1 = creative).

**Tuning:**

- **Lower (0-0.1)**: Most deterministic (best for extraction)
- **Default (0.2)**: Slightly varied but consistent
- **Higher (0.5-1.0)**: More creative (NOT recommended for extraction)

**Example:**

```bash
LLM_TEMPERATURE=0.1  # Very deterministic
```

**Trade-offs:**

- ✅ Lower (0-0.2) = faster, more consistent, better for extraction
- ⚠️ Higher = slower, less consistent

---

### Recommended Presets

#### Speed-Optimized (10x faster target)

```bash
EXTRACT_PAGE_CONCURRENCY=8
OCR_TEXT_THRESHOLD=300
EXTRACT_FLUSH_BATCH_SIZE=25
LLM_TIMEOUT_MS=35000
LLM_MAX_OUTPUT_TOKENS_PRIMARY=1536
LLM_TEMPERATURE=0.1
```

#### Balanced (default)

```bash
EXTRACT_PAGE_CONCURRENCY=4
OCR_TEXT_THRESHOLD=400
EXTRACT_FLUSH_BATCH_SIZE=10
LLM_TIMEOUT_MS=45000
LLM_MAX_OUTPUT_TOKENS_PRIMARY=2048
LLM_TEMPERATURE=0.2
```

#### Accuracy-Optimized (slower but more thorough)

```bash
EXTRACT_PAGE_CONCURRENCY=2
OCR_TEXT_THRESHOLD=600
EXTRACT_FLUSH_BATCH_SIZE=5
LLM_TIMEOUT_MS=60000
LLM_MAX_OUTPUT_TOKENS_PRIMARY=3072
LLM_TEMPERATURE=0.2
```

---

### Implementation Details

**Extraction Service Variables:**

- Defined in: `apps/backend/src/extraction/services/extraction.service.ts`
- Lines: 54-69

**LLM Service Variables:**

- Defined in all LLM services:
  - `apps/backend/src/shared/llm/services/openai.service.ts`
  - `apps/backend/src/shared/llm/services/gemini.service.ts`
  - `apps/backend/src/shared/llm/services/anthropic.service.ts`
  - `apps/backend/src/shared/llm/services/mistral.service.ts`

All variables are accessed via `ConfigService.get()` which reads from environment variables.

---

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm run start:dev

# Run tests
pnpm run test

# Build
pnpm run build
```

## Environment Setup

Create a `.env` file in the backend directory with the required variables:

```bash
# Database
DATABASE_URL=postgresql://...

# API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
MISTRAL_API_KEY=...

# Supabase
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=...

# Storage
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET_PROCESSING=...
S3_BUCKET_ASSETS=...

# Performance Tuning (optional - see above for details)
EXTRACT_PAGE_CONCURRENCY=4
OCR_TEXT_THRESHOLD=400
EXTRACT_FLUSH_BATCH_SIZE=10
LLM_TIMEOUT_MS=45000
LLM_MAX_OUTPUT_TOKENS_PRIMARY=2048
LLM_TEMPERATURE=0.2
```
