# 🔍 Intelligent Media Processing Pipeline

Hey there! This is an asynchronous backend system I built to process uploaded vehicle images, check them for quality issues, and give back structured analysis results.

I built it using **Node.js**, **TypeScript**, **Express**, **SQLite**, and **Sharp**.

**Deployed link**: <a href="https://intelligent-media-processing-pipeline-j2va.onrender.com/dashboard.html" target="_blank" rel="noopener noreferrer">https://intelligent-media-processing-pipeline-j2va.onrender.com/dashboard.html</a>

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
- [Test images with its ouput and failures](#test-images-with-its-output-and-failures)

---

## Architecture

### System Overview

Here's a high-level look at how everything connects:

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

1. **Upload**: The client fires an image over to `POST /api/v1/images/upload`.
2. **Store**: We save the image to disk and stash its metadata (plus a SHA-256 hash) in SQLite.
3. **Enqueue**: The image's ID gets pushed to an in-memory queue.
4. **Response**: The client gets a fast `201` response with a processing ID (usually under 50ms).
5. **Async Processing**: A background worker picks up the job, marks it as `processing`, and runs all 7 analyzers (dimension checks go first, the rest run in parallel). Once done, it saves all results in a single database transaction, calculates a final score, and marks the job as `completed` (or `failed`).
6. **Retrieve**: The client can then poll our status/results APIs to see the final output.

### Queue Strategy

**My approach**: I went with a custom in-memory queue that handles concurrency. 

**Why?**: Since this is a just an assignment, using Redis and BullMQ felt like it would just complicate the infrastructure without really proving much. Building a custom queue was enough to handle:
- Concurrency limits (it defaults to 3 jobs at a time)
- Exponential backoff for retries (starts at 2s, max 3 tries)
- A dead letter queue for jobs that completely fail
- Event-driven logging
- Graceful shutdowns (making sure active jobs finish before the server dies)

**Moving to production**: If this were a real app, you could just swap my `ProcessingQueue` class for a BullMQ adapter since they share the same interface.

### Database Schema

```sql
images (id, filename, path, size, mime, hash, status, retry_count, 
        error_message, overall_score, issues_found, timestamps)

analysis_results (id, image_id, analyzer_name, passed, confidence, 
                  details[JSON], execution_time_ms)

image_hashes (id, image_id, file_hash, perceptual_hash)
```

A few key decisions here:
- I turned on **WAL mode** in SQLite so concurrent reads don't block.
- Added **indexes** on things we query often (status, file_hash, created_at).
- Used a **JSON column** for details, so that analyzer can store whatever data it needs.
- Created a **separate hash table** to check duplicates as fast as possible.

---

## Features

### Core Stuff
-  RESTful API for handling uploads, checking status, and pulling results.
-  Fully asynchronous processing using a queue-based design.
-  7 distinct image quality analyzers, complete with confidence scoring.
-  SQLite for storage with right schemas and indexes.
-  Clean JSON responses that include HATEOAS links.

### Extra Features
- **Dashboard UI**: I built a real-time web dashboard so you can actually see the uploads, stats, and results in action.
- **Rate Limiting**: Kept things normal with limits (10 uploads/min, 1000 requests/15min).
- **Retry Mechanism**: Failing jobs back off exponentially before hitting a dead letter queue.
- **Docker Setup**: Included a Dockerfile and docker-compose to make it run in any environment.
- **Automated Tests**: Got coverage with Jest and Supertest.
- **Structured Logging**: Winston handles the logs, complete with file rotation.
- **Graceful Shutdown**: The server won't just kill active jobs or database connections when you hit Ctrl+C.
- **Security**: Added Helmet headers, CORS, and strict file type validation.
- **Confidence Scoring**: Each analyzer returns a confidence score, which feeds into a weighted overall score.
- **Pagination**: The listing API is fully paginated and filterable.
- **Health Check**: A simple `/health` endpoint to monitor uptime and memory.

---

## Quick Start

### Prerequisites
You'll need:
- **Node.js** 18+ (20+ is even better)
- **npm** 8+

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd gogig

# Install dependencies
npm install

# Create environment file (the defaults in here will work fine out of the box)
cp .env.example .env

# Start the dev server
npm run dev
```

The server spins up at `http://localhost:3000` and you can hit the dashboard at `http://localhost:3000/dashboard.html`.

### Test Upload

```bash
# Upload an image using the included script
node scripts/test-upload.js path/to/your-image.jpg

# Or just use curl
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

**Response** (200 when done, 202 if still processing):
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

Here's a breakdown of the 7 checks running under the hood:

### 1. Blur Detection (`blur_detection`)
- **How it works**: I convert the image to grayscale and apply a Laplacian edge-detection kernel, then measure the variance.
- **The catch**: If the variance is under 100, it's flagged as blurry.
- **Levels**: It categorizes blur into none, mild, moderate, or severe.

### 2. Brightness Analysis (`brightness_analysis`)
- **How it works**: It looks at the statistical distribution of grayscale pixels.
- **What it flags**: Checks for images that are too dark (mean < 40) or washed out/too bright (mean > 220).
- **Tuning**: I intentionally relaxed the contrast thresholds. Real-world outdoor photos of vehicles (like on cloudy days or in shadows) were triggering too many false positives, so I gave it some breathing room.

### 3. Duplicate Detection (`duplicate_detection`)
- **How it works**: It uses two hashes. A SHA-256 hash catches exact duplicate files, and a perceptual hash (aHash) catches visually similar images (using a Hamming distance threshold of 10 bits).
- **Trade-off**: aHash is fast and simple, but if I had more time, pHash would be better at handling rotated or scaled images.

### 4. Dimension Validation (`dimension_validation`)
- **How it works**: Just your standard checks for min/max dimensions, weird aspect ratios (anything beyond 4:1 gets flagged), and suspicious compression ratios.

### 5. Screenshot / Photo-of-Photo Detection (`screenshot_detection`)
- **How it works**: I set up a scoring system based on heuristics. If an image scores 3.5 or higher, it's flagged.
  - Common screenshot resolutions (+1.0)
  - Solid, uniform borders at the top/bottom (+1.5)
  - Missing EXIF data (+0.5) *Note: Weighted this lower since WhatsApp and other apps strip EXIF anyway.*
  - PNG format (+0.5)
  - Moiré patterns (+2.0) *Note: I raised this threshold because detailed textures on cars were accidentally triggering it.*

### 6. OCR + Number Plate Validation (`ocr_plate_validation`)
- **How it works**: It uses Tesseract.js (but won't crash if it's missing). 
- **Preprocessing**: Before running OCR, I use Sharp to split the image into 4 regions (Full, Bottom 40%, Bottom-Left, Bottom-Right) and normalize them. This makes a massive difference for finding plates tucked away in corners.
- **Validation**: It checks against all 37 Indian state/UT codes and the standard format (`XX 00 XX 0000`).
- **Limitations**: It still cannot detect plates under different shadows, sometimes cannot give accurate output.

### 7. Metadata / Tampering Analysis (`metadata_tampering`)
- **How it works**: Looks for weird stuff like missing EXIF data on JPEGs, an unexpected alpha channel, or channel statistics that don't make sense. If it hits a threshold of 2.0, it flags the image as potentially tampered with.

---

## Trade-offs & Design Decisions

Made some practical choices to build this project in limited timeframe.

### Things I simplified
- **The Queue**: As mentioned, I used an in-memory queue instead of Redis + BullMQ. 
- **The Database**: Used SQLite because it is enough for limited concurrent writes, but with more timeframe and scale, I can upgrade to PostgreSQL or MySql.
- **Storage**: Files just save to the local disk.
- **OCR**: Tesseract.js is okay, but a true ALPR (Automated License Plate Recognition) system needs an object detection model like YOLO to crop the plate first before trying to read it.
- **Auth**: I skipped authentication (JWT/API keys) to keep the focus on the processing pipeline.

### Where things might break at scale
1. **Lost processes**: Because the queue is in memory, if the server restarts, we lose active processes. To prevent this, the app could re-queue anything stuck in `processing` on startup.
2. **Database locks**: SQLite in WAL mode handles concurrent reads well, but writes are still single-threaded. We'd hit a bottleneck around 100 writes/sec.
3. **Storage**: Local storage obviously won't work if we scale to multiple server instances.
4. **OCR Accuracy**: Tesseract is meant for documents (black text, white background). It can't detect and process plates that are angled, dirty, or low contrast.
5. **Memory usage**: We can compare hash against every other hash we have. At scale, we'd need a vector database like FAISS.

### Handling failures gracefully
- If one analyzer crashes, it doesn't take down the whole analyzers. It just gets marked as inconclusive.
- Failed queue jobs get retried 3 times with a backoff delay.
- If it completely fails, it goes to a dead letter queue so we can debug it later.
- If the app hits an uncaught exception, it tries to finish active jobs before shutting down.
- If an upload files midway, we clean up the orphaned file so the disk doesn't fill up.

---

## AI Usage Disclosure

Full disclosure on how I used AI while building this.

**Where AI helped:**
- **Brainstorming**: Suggesting ideas for the architecture and figuring out which heuristics make sense for image analysis.
- **Boilerplate**: Getting the Express setup and multer config out of the way quickly.
- **Dashboard UI**: Generating the HTML/CSS/JS for the frontend interface.

**Where AI messed up (and how I fixed it):**
1. **TypeScript types**: AI thought Express 5's `req.params` was a `string`, but it's different. The way it destructed puzzled the whole build, so I had to fix the type casting to further errors.
2. **Math mistakes**: It tried to manually calculate standard deviation for the brightness analyzer, completely missing that `sharp.stats()` already gives us the `stdev` directly. Then I removed calculation part to make stats() function give standard deviation.
3. **SQL quirks**: It used a `SUM` function in SQLite that was returning `null` when no rows matched. I had to wrap it in a `COALESCE` to ensure it returned `0`.

---

## Running Tests

```bash
# Run the test suite
npm test

# Run in watch mode for development
npm run test:watch
```

The tests cover:
- Health endpoints
- Uploads (with and without actual files)
- Handling invalid IDs
- Pagination logic
- The statistics endpoint
- 404 routing

---

## Docker Setup

If you want to run it in a container, it's ready to go:

```bash
# Spin it all up with Docker Compose
docker-compose up --build

# Or build and run it manually
docker build -t media-pipeline .
docker run -p 3000:3000 media-pipeline
```

---

## Project Structure

```
gogig/
├── src/
│   ├── analyzers/           # All the image checking logic lives here
│   │   ├── index.ts           
│   │   ├── blurDetector.ts    
│   │   ├── brightnessAnalyzer.ts  
│   │   ├── duplicateDetector.ts   
│   │   ├── dimensionValidator.ts  
│   │   ├── screenshotDetector.ts  
│   │   ├── ocrAnalyzer.ts     
│   │   └── metadataAnalyzer.ts    
│   ├── config/
│   │   ├── database.ts        # SQLite setup
│   │   └── env.ts             # Environment variables mapping
│   ├── controllers/
│   │   ├── upload.controller.ts   
│   │   └── results.controller.ts  
│   ├── middleware/
│   │   └── errorHandler.ts    
│   ├── models/
│   │   └── image.model.ts     # DB queries
│   ├── queue/
│   │   └── processingQueue.ts # The custom job queue
│   ├── routes/
│   │   └── index.ts           
│   ├── services/
│   │   └── imageProcessor.ts  # Runs all the analyzers together
│   ├── utils/
│   │   └── logger.ts          
│   └── app.ts                 # Main entry point
├── public/
│   └── dashboard.html         # The frontend UI
├── scripts/
│   └── test-upload.js         
├── tests/
│   └── api.test.ts            
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## What I Would Improve

If I had another weekend to work on this, here's what I'd tackle next:

1. **WebSockets**: Stop polling for results and just push updates to the client in real-time.
2. **Thumbnails**: Generate small previews during processing to show on the dashboard.
3. **Database Upgrade**: Move to PostgreSQL and bring in an ORM like Prisma or Drizzle.
4. **Pro Job Queue**: Swap my custom queue for Redis + BullMQ.
5. **Better Tracing**: Add OpenTelemetry so I can trace a request's full lifecycle.
6. **Real ML**: Replace my heuristic-based screenshot detection with an actual trained classifier.
7. **Cloud Storage**: Move file uploads to S3 with pre-signed URLs.
8. **Auth**: Lock down the API with JWTs and API keys.
9. **Batch Processing**: Allow users to upload a whole folder of images at once.
10. **Webhooks**: Add support for pinging a webhook URL when a job finishes.

---

## Assumptions

A few things I assumed while building this:
1. People are uploading standard web formats (JPEG, PNG, WebP, BMP).
2. The app is running on a single server for now (hence the in-memory queue).
3. We're only looking at standard Indian vehicle plates (`XX 00 XX 0000`).
4. We won't hit more than 100 concurrent users, making SQLite perfectly fine.
5. Tesseract.js is acceptable for a tech demo, even though it's not robust enough for a real-world ALPR system.
6. The analysis thresholds might need more preprocessing, so they can be changed via environment variables.

---

## User Interface & Results
<img width="942" height="419" alt="Screenshot 2026-07-20 205843" src="https://github.com/user-attachments/assets/2941fa5f-37c4-4ad7-996f-a7570f7417ae" />
<img width="933" height="210" alt="image" src="https://github.com/user-attachments/assets/7d9f790c-1bb7-403e-9109-cb1c5feef0fb" />

---

## Test images with its output and failures

### Image Input 1
<img width="596" height="394" alt="1c6c9347-7e01-49b4-8be7-74b0c01fbfdb" src="https://github.com/user-attachments/assets/69b5766b-abee-4f2d-b7a5-5bce44762e3a" />

### Output 1
<img width="596" height="394" alt="image" src="https://github.com/user-attachments/assets/4eccabad-1939-4fb6-a1c0-b9f8ae53b2c2" />
<img width="596" height="394" alt="Screenshot 2026-07-21 200257" src="https://github.com/user-attachments/assets/7149f06d-cf03-4513-8c40-5410af1bb613" />

### Failures
- initially not able to detect numberplate, later improved
- Sometimes detects numberplate, but not always
- but eventually, its not even detecting numberplate because of OCR failure
  
---

### Image Input 2
<img width="596" height="394" alt="011d9615-2b0f-4e76-b24a-f435a5b3f554" src="https://github.com/user-attachments/assets/25e26d83-f384-4f94-87ed-43c7dc7e4663" />

### Ouput 2
<img width="596" height="394" alt="Screenshot 2026-07-21 201054" src="https://github.com/user-attachments/assets/9f6032ac-0022-47c9-9013-727df818d40c" />
<img width="596" height="394" alt="Screenshot 2026-07-21 200340" src="https://github.com/user-attachments/assets/23557fc4-a741-41b8-9e5c-3966a6dea2b5" />

### Failures
- initially detected numberplate but with incorrect output
- later improved with more preprocessing techniques
- but OCR failure caused to not detect numberplate

---

### Image Input 3
<img width="596" height="394" alt="b5b61d94-f8b1-47c8-892b-0a3175c7c139" src="https://github.com/user-attachments/assets/1a64c0f7-0565-432b-abbf-121a9dd4a88d" />

### Output 3
<img width="596" height="394" alt="image" src="https://github.com/user-attachments/assets/1d93f67a-b29a-4b13-94f3-cdd2b213dc51" />
<img width="596" height="394" alt="image" src="https://github.com/user-attachments/assets/3417f2a7-abb3-498e-934e-eccc968618b6" />

## Failures
- same here, sometimes detected, sometimes not
- once it detected as ai generated image, later it improved some modification
