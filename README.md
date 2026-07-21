# 🔍 Intelligent Media Processing Pipeline

An asynchronous backend system for processing uploaded vehicle images, detecting quality issues, and providing structured analysis results.

Built with **Node.js**, **TypeScript**, **Express**, **SQLite**, and **Sharp**.

---

## 📋 Table of Contents

- [Architecture](#architecture)
- [Features](#features)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Image Analyzers](#image-analyzers)
- [Trade-offs & Design Decisions](#trade-offs--design-decisions)
- [AI Usage Disclosure](#ai-usage-disclosure)
- [Running Tests](#running-tests)
- [Docker Setup](#docker-setup)
- [Project Structure](#project-structure)
- [What I Would Improve](#what-i-would-improve)

---

## Architecture

### System Overview

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│   Client /   │────▶│  Express API │────▶│  In-Memory Queue │
│   Dashboard  │     │  (Upload)    │     │  (Concurrency=3) │
└──────────────┘     └──────┬───────┘     └────────┬─────────┘
                            │                      │
                     ┌──────▼───────┐     ┌────────▼─────────┐
                     │   SQLite DB  │◀────│  Image Processor │
                     │   (WAL mode) │     │   (7 Analyzers)  │
                     └──────────────┘     └──────────────────┘
```

### Processing Flow

1. **Upload**: Client sends image via `POST /api/v1/images/upload`
2. **Store**: Image saved to disk, metadata + SHA-256 hash stored in SQLite
3. **Enqueue**: Image ID pushed to in-memory processing queue
4. **Response**: Client receives `201` with processing ID immediately (< 50ms)
5. **Async Processing**: Queue worker picks up the job:
   - Updates status to `processing`
   - Runs 7 analyzers (dimension check first, then 6 in parallel)
   - Stores all results in a single DB transaction
   - Calculates weighted overall score
   - Updates status to `completed` or `failed`
6. **Retrieve**: Client polls for results via status/results APIs

### Queue Strategy

**Choice**: Custom in-memory queue with concurrency control.

**Rationale**: For a take-home assignment, adding Redis + BullMQ would increase infrastructure complexity without demonstrating additional engineering understanding. The custom implementation shows:
- Concurrency limiting (configurable, default 3)
- Exponential backoff retries (base 2s, max 3 attempts)
- Dead letter queue for permanently failed jobs
- Event-driven architecture for logging/monitoring
- Graceful shutdown (waits for active jobs)

**Production upgrade path**: Swap `ProcessingQueue` class with BullMQ adapter (same interface).

### Database Schema

```sql
images (id, filename, path, size, mime, hash, status, retry_count, 
        error_message, overall_score, issues_found, timestamps)

analysis_results (id, image_id, analyzer_name, passed, confidence, 
                  details[JSON], execution_time_ms)

image_hashes (id, image_id, file_hash, perceptual_hash)
```

Key design choices:
- **WAL mode** for better concurrent read performance
- **Indexes** on status, file_hash, and created_at for query performance
- **JSON details column** for flexible per-analyzer data storage
- **Separate hash table** for efficient duplicate detection lookups

---

## Features

### Core
- ✅ RESTful API for image upload, status checking, and result retrieval
- ✅ Async processing with queue-based architecture
- ✅ 7 image quality analyzers with confidence scoring
- ✅ SQLite persistence with proper schema and indexes
- ✅ Structured JSON responses with HATEOAS links

### Bonus
- ✅ **Dashboard UI** - Real-time web dashboard with upload, stats, and result viewing
- ✅ **Rate Limiting** - Per-endpoint rate limits (10 uploads/min, 100 requests/15min)
- ✅ **Retry Mechanism** - Exponential backoff with dead letter queue
- ✅ **Docker Setup** - Dockerfile + docker-compose.yml
- ✅ **Automated Tests** - Jest + Supertest API tests
- ✅ **Structured Logging** - Winston with file rotation and structured metadata
- ✅ **Graceful Shutdown** - Proper cleanup of connections and active jobs
- ✅ **Security** - Helmet headers, CORS, file type validation
- ✅ **Confidence Scoring** - Per-analyzer confidence + weighted overall score
- ✅ **Pagination** - Paginated listing with status filtering
- ✅ **Health Check** - `/health` endpoint with uptime and memory stats

---

## Quick Start

### Prerequisites
- **Node.js** 18+ (recommended: 20+)
- **npm** 8+

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd gogig

# Install dependencies
npm install

# Create environment file (optional - defaults work out of the box)
cp .env.example .env

# Start the development server
npm run dev
```

The server starts at `http://localhost:3000` and the dashboard at `http://localhost:3000/dashboard.html`.

### Test Upload

```bash
# Upload an image
node scripts/test-upload.js path/to/your-image.jpg

# Or use curl
curl -X POST http://localhost:3000/api/v1/images/upload \
  -F "image=@path/to/image.jpg"
```

---

## API Reference

### Upload Image

```http
POST /api/v1/images/upload
Content-Type: multipart/form-data

Field: image (file)
```

**Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "5ba228c3-d971-48ae-b5a7-d958f2883f9a",
    "status": "pending",
    "filename": "vehicle_photo.jpg",
    "fileSize": 245760,
    "mimeType": "image/jpeg",
    "createdAt": "2026-07-20 09:58:05"
  },
  "message": "Image uploaded successfully. Processing will begin shortly.",
  "_links": {
    "status": "/api/v1/images/5ba228c3-.../status",
    "results": "/api/v1/images/5ba228c3-.../results"
  }
}
```

### Check Processing Status

```http
GET /api/v1/images/:id/status
```

**Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "5ba228c3-...",
    "status": "completed",
    "filename": "vehicle_photo.jpg",
    "retryCount": 0,
    "createdAt": "2026-07-20 09:58:05",
    "updatedAt": "2026-07-20T09:58:10.290Z",
    "completedAt": "2026-07-20T09:58:10.290Z"
  }
}
```

### Get Analysis Results

```http
GET /api/v1/images/:id/results
```

**Response** (200 when completed, 202 when still processing):
```json
{
  "success": true,
  "data": {
    "id": "5ba228c3-...",
    "status": "completed",
    "filename": "vehicle_photo.jpg",
    "dimensions": { "width": 640, "height": 480 },
    "overallScore": 0.85,
    "issuesFound": 1,
    "totalChecks": 7,
    "analyses": [
      {
        "analyzer": "blur_detection",
        "passed": true,
        "confidence": 0.95,
        "details": {
          "laplacianVariance": 245.67,
          "threshold": 100,
          "verdict": "Image sharpness is acceptable",
          "severity": "none"
        },
        "executionTimeMs": 183
      }
    ]
  }
}
```

### List All Images

```http
GET /api/v1/images?page=1&limit=20&status=completed
```

### Pipeline Statistics

```http
GET /api/v1/stats
```

### Health Check

```http
GET /health
```

---

## Image Analyzers

### 1. Blur Detection (`blur_detection`)
- **Method**: Laplacian variance on grayscale image
- **How**: Convolves with edge-detection kernel, measures result variance
- **Threshold**: Variance < 100 = blurry
- **Severity levels**: none, mild, moderate, severe

### 2. Brightness Analysis (`brightness_analysis`)
- **Method**: Statistical analysis of grayscale pixel distribution
- **Checks**: Mean brightness (too dark < 40, too bright > 220), contrast (stddev < 8 && range < 30)
- **Real-World Tuning**: Contrast thresholds were specifically relaxed to accommodate real-world outdoor lighting conditions (e.g., cloudy days or shadows on vehicles) to prevent false positives.
- **Output**: Dark/bright/low-contrast flags with specific values

### 3. Duplicate Detection (`duplicate_detection`)
- **Method**: Dual-hash approach
  - **SHA-256**: Exact file duplicate detection
  - **Perceptual hash (aHash)**: 256-bit average hash for visual similarity
  - **Hamming distance**: Threshold of 10 bits for "similar" classification
- **Trade-off**: aHash is simple but effective; pHash would be more robust against rotation/scaling

### 4. Dimension Validation (`dimension_validation`)
- **Checks**: Min/max dimensions, aspect ratio extremes, compression ratio
- **Flags**: Too small, too large, extreme aspect ratio (>4:1), suspicious compression

### 5. Screenshot / Photo-of-Photo Detection (`screenshot_detection`)
- **Heuristics** (scored, threshold ≥ 3.5):
  - Matches common screenshot resolutions (+1.0)
  - Uniform color borders at top/bottom (+1.5)
  - Missing camera EXIF data (+0.5) - *Weighted lower since messaging apps (WhatsApp) strip EXIF.*
  - PNG format (+0.5)
  - Moiré pattern via high-pass filter mean > 50 (+2.0) - *Threshold raised to prevent detailed vehicle textures from triggering false positives.*

### 6. OCR + Number Plate Validation (`ocr_plate_validation`)
- **Engine**: Tesseract.js (falls back gracefully if unavailable)
- **Preprocessing**: Multi-region processing using Sharp. The image is split into 4 distinct regions (Full, Bottom 40%, Bottom-Left, Bottom-Right) and normalized before OCR. This vastly improves the chances of detecting plates located in corners without warping the image.
- **Validation**: Indian vehicle plate format (`XX 00 XX 0000`)
- **State codes**: All 37 Indian state/UT codes validated
- **Limitations**: See *Trade-offs* section below regarding ALPR vs Document OCR.

### 7. Metadata / Tampering Analysis (`metadata_tampering`)
- **Checks**: EXIF presence on JPEGs, channel statistical anomalies, alpha channel presence, color space consistency, density validation
- **Scored**: Threshold of 2.0 out of 4.5 triggers suspicious flag

---

## Trade-offs & Design Decisions

### Intentional Simplifications

| Area | Simplification | Production Alternative |
|------|---------------|----------------------|
| **Queue** | In-memory queue | BullMQ + Redis for persistence & distribution |
| **Database** | SQLite | PostgreSQL for concurrent writes at scale |
| **Storage** | Local filesystem | S3/GCS with signed URLs |
| **OCR (ALPR)**| Tesseract.js (JS-based) | YOLO Object Detection + AWS Textract / Google Vision |
| **Auth** | None | JWT + API keys |
| **Duplicate detection** | Average hash | pHash + feature-based matching |

### Scalability Concerns

1. **In-memory queue**: Jobs lost on server restart. Mitigation: On startup, re-queue any images in `processing` status.
2. **SQLite write locks**: Single writer at a time. WAL mode helps reads but won't scale past ~100 writes/second.
3. **Local file storage**: Won't work across multiple server instances. Need shared storage (S3).
4. **OCR Limitations**: Tesseract.js is a *Document OCR* engine. It is designed for horizontal black text on white backgrounds. It struggles heavily with "in-the-wild" text—specifically painted, angled, curved, and low-contrast license plates on the physical bodies of auto-rickshaws. **Production Fix**: A true ALPR pipeline requires an Object Detection model (like YOLO) to draw a bounding box around the plate and flatten it *before* passing that specific crop to a specialized ALPR OCR engine.
5. **Memory**: Perceptual hash comparison is O(n) against all stored hashes. Need a vector index (e.g., FAISS) at scale.

### Failure Handling

- **Analyzer failures**: Individual analyzer failures don't fail the entire job — they're recorded as inconclusive
- **Queue retries**: 3 retries with exponential backoff (2s, 4s, 8s)
- **Dead letter queue**: Permanently failed jobs tracked for debugging
- **Graceful shutdown**: Active jobs complete before server exits
- **File cleanup**: On upload errors, orphaned files are deleted
- **Uncaught exceptions**: Logged and trigger graceful shutdown

---

## AI Usage Disclosure

### Where AI Was Used

| Area | Tool | What It Helped With |
|------|------|-------------------|
| **Architecture planning** | Claude | System design, analyzer selection, schema design |
| **Code generation** | Claude | Boilerplate (Express setup, multer config), analyzer implementations |
| **Dashboard UI** | Claude | HTML/CSS/JS for the dashboard interface |
| **README writing** | Claude | Structure, formatting, API documentation |

### Where AI Output Was Wrong or Needed Correction

1. **TypeScript types**: Express 5's `req.params` type is `string | string[]`, not `string`. AI initially used destructuring which caused TS errors. Fixed with explicit type casting.
2. **Brightness analyzer**: Initial `stdev` calculation was incorrect — `sharp.stats()` already provides `stdev` directly on channel objects, no need for manual calculation.
3. **SQLite `SUM` with conditions**: Returns `null` not `0` when no rows match. Needed `COALESCE` or frontend handling.

### How AI-Generated Code Was Validated

1. **TypeScript strict mode**: `tsc --noEmit` catches type errors before runtime
2. **Manual testing**: Uploaded test images and verified each analyzer's output against expected behavior
3. **End-to-end verification**: Used `scripts/test-upload.js` to verify the complete flow
4. **Code review**: Read through all generated code, understanding each decision and modifying where needed
5. **Edge cases**: Tested with synthetic images (solid color, tiny files) to verify graceful handling

### AI Usage Philosophy

I used AI as a **productivity multiplier**, not a replacement for understanding. Every architectural decision, analyzer approach, and error handling strategy was reasoned about before implementation. AI accelerated the boilerplate and helped explore approaches, but the system design and quality decisions were deliberate engineering choices.

---

## Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch
```

Tests cover:
- Health check endpoint
- Upload with and without files
- Status/Results for invalid IDs
- Paginated listing
- Statistics endpoint
- 404 handling

---

## Docker Setup

```bash
# Build and run with Docker Compose
docker-compose up --build

# Or build manually
docker build -t media-pipeline .
docker run -p 3000:3000 media-pipeline
```

---

## Project Structure

```
gogig/
├── src/
│   ├── analyzers/           # Image analysis modules
│   │   ├── index.ts           # Analyzer registry
│   │   ├── blurDetector.ts    # Laplacian variance blur detection
│   │   ├── brightnessAnalyzer.ts  # Luminance & contrast analysis
│   │   ├── duplicateDetector.ts   # SHA-256 + perceptual hash
│   │   ├── dimensionValidator.ts  # Size & aspect ratio checks
│   │   ├── screenshotDetector.ts  # Screenshot/photo-of-photo heuristics
│   │   ├── ocrAnalyzer.ts     # Tesseract OCR + Indian plate validation
│   │   └── metadataAnalyzer.ts    # EXIF/tampering heuristics
│   ├── config/
│   │   ├── database.ts        # SQLite initialization & schema
│   │   └── env.ts             # Centralized environment config
│   ├── controllers/
│   │   ├── upload.controller.ts   # Upload handling + multer
│   │   └── results.controller.ts  # Status, results, listing, stats
│   ├── middleware/
│   │   └── errorHandler.ts    # Error handling + request logging
│   ├── models/
│   │   └── image.model.ts     # Data access layer (Image, Analysis, Hash)
│   ├── queue/
│   │   └── processingQueue.ts # In-memory queue with retries
│   ├── routes/
│   │   └── index.ts           # Route definitions + rate limiting
│   ├── services/
│   │   └── imageProcessor.ts  # Orchestrates all analyzers
│   ├── utils/
│   │   └── logger.ts          # Winston structured logging
│   └── app.ts                 # Application entry point
├── public/
│   └── dashboard.html         # Web dashboard
├── scripts/
│   └── test-upload.js         # Upload test script
├── tests/
│   └── api.test.ts            # API integration tests
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## What I Would Improve

With more time, I would add:

1. **WebSocket notifications** for real-time processing updates instead of polling
2. **Image thumbnails** generated during processing for dashboard preview
3. **PostgreSQL migration** with a proper ORM (Prisma/Drizzle)
4. **BullMQ integration** with Redis for production-grade job processing
5. **OpenTelemetry tracing** for full request lifecycle observability
6. **ML-based classifiers** for screenshot/tampering detection (instead of heuristics)
7. **S3 storage adapter** with pre-signed upload URLs
8. **API authentication** with JWT tokens and API key management
9. **Batch upload** endpoint for processing multiple images
10. **Webhook callbacks** on processing completion

---

## Assumptions

1. Images are uploaded as standard web formats (JPEG, PNG, WebP, BMP)
2. The system runs on a single server (queue is in-memory)
3. Indian vehicle number plates follow standard format: `XX 00 XX 0000`
4. SQLite is sufficient for the expected load (< 100 concurrent users)
5. Tesseract.js accuracy is acceptable for a demonstration (not production OCR)
6. Analysis thresholds are configurable via environment variables

---

## User Interface with resulted information
<img width="942" height="419" alt="Screenshot 2026-07-20 205843" src="https://github.com/user-attachments/assets/2941fa5f-37c4-4ad7-996f-a7570f7417ae" />
<img width="920" height="216" alt="Screenshot 2026-07-20 205856" src="https://github.com/user-attachments/assets/a41135fb-9652-4034-81c3-9bc99172c686" />
<img width="939" height="416" alt="Screenshot 2026-07-20 205912" src="https://github.com/user-attachments/assets/fefc13db-5b2b-4781-aa2f-b18512f2f53b" />
<img width="937" height="424" alt="Screenshot 2026-07-20 205927" src="https://github.com/user-attachments/assets/094ca950-9a24-4be3-8900-4d7290376a2a" />

## Example vehicle image input
<img width="1300" height="960" alt="image" src="https://github.com/user-attachments/assets/060b4532-ca22-46d1-a24a-a9bc5fd4a0fd" />
<img width="720" height="540" alt="image" src="https://github.com/user-attachments/assets/b8581adb-716f-40dc-b2ed-8255a24291fc" />
