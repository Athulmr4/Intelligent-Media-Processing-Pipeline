import { getDb } from '../config/database';
import { logger } from '../utils/logger';

// ─── Type Definitions ────────────────────────────────────────────────

export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ImageRecord {
  id: string;
  original_filename: string;
  stored_path: string;
  file_size: number;
  mime_type: string;
  file_hash: string;
  width: number | null;
  height: number | null;
  status: ProcessingStatus;
  retry_count: number;
  error_message: string | null;
  overall_score: number | null;
  issues_found: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface AnalysisResult {
  id: number;
  image_id: string;
  analyzer_name: string;
  passed: number; // SQLite boolean: 0 or 1
  confidence: number | null;
  details: string | null; // JSON string
  execution_time_ms: number | null;
  created_at: string;
}

export interface ImageHash {
  id: number;
  image_id: string;
  file_hash: string;
  perceptual_hash: string | null;
  created_at: string;
}

// ─── Image Operations ────────────────────────────────────────────────

export const ImageModel = {
  /**
   * Insert a new image record.
   */
  create(data: {
    id: string;
    original_filename: string;
    stored_path: string;
    file_size: number;
    mime_type: string;
    file_hash: string;
    width?: number;
    height?: number;
  }): ImageRecord {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO images (id, original_filename, stored_path, file_size, mime_type, file_hash, width, height)
      VALUES (@id, @original_filename, @stored_path, @file_size, @mime_type, @file_hash, @width, @height)
    `);
    stmt.run({
      ...data,
      width: data.width ?? null,
      height: data.height ?? null,
    });
    logger.debug('Image record created', { id: data.id, filename: data.original_filename });
    return ImageModel.findById(data.id)!;
  },

  /**
   * Find image by ID.
   */
  findById(id: string): ImageRecord | undefined {
    const db = getDb();
    return db.prepare('SELECT * FROM images WHERE id = ?').get(id) as ImageRecord | undefined;
  },

  /**
   * List images with pagination and optional status filter.
   */
  findAll(options: { page?: number; limit?: number; status?: ProcessingStatus } = {}): {
    images: ImageRecord[];
    total: number;
    page: number;
    totalPages: number;
  } {
    const db = getDb();
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const offset = (page - 1) * limit;

    let whereClause = '';
    const params: any[] = [];

    if (options.status) {
      whereClause = 'WHERE status = ?';
      params.push(options.status);
    }

    const countRow = db.prepare(`SELECT COUNT(*) as count FROM images ${whereClause}`).get(...params) as { count: number };
    const total = countRow.count;

    const images = db.prepare(
      `SELECT * FROM images ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as ImageRecord[];

    return {
      images,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  },

  /**
   * Update image processing status.
   */
  updateStatus(id: string, status: ProcessingStatus, extra?: {
    error_message?: string;
    overall_score?: number;
    issues_found?: number;
    width?: number;
    height?: number;
  }): void {
    const db = getDb();
    const now = new Date().toISOString();
    const completedAt = (status === 'completed' || status === 'failed') ? now : null;

    const stmt = db.prepare(`
      UPDATE images
      SET status = ?,
          updated_at = ?,
          completed_at = COALESCE(?, completed_at),
          error_message = COALESCE(?, error_message),
          overall_score = COALESCE(?, overall_score),
          issues_found = COALESCE(?, issues_found),
          width = COALESCE(?, width),
          height = COALESCE(?, height)
      WHERE id = ?
    `);

    stmt.run(
      status,
      now,
      completedAt,
      extra?.error_message ?? null,
      extra?.overall_score ?? null,
      extra?.issues_found ?? null,
      extra?.width ?? null,
      extra?.height ?? null,
      id
    );

    logger.debug('Image status updated', { id, status });
  },

  /**
   * Increment retry count.
   */
  incrementRetry(id: string): number {
    const db = getDb();
    db.prepare('UPDATE images SET retry_count = retry_count + 1, updated_at = datetime("now") WHERE id = ?').run(id);
    const row = db.prepare('SELECT retry_count FROM images WHERE id = ?').get(id) as { retry_count: number };
    return row.retry_count;
  },

  /**
   * Get aggregate statistics.
   */
  getStats(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    avgScore: number | null;
  } {
    const db = getDb();
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        AVG(CASE WHEN status = 'completed' THEN overall_score ELSE NULL END) as avgScore
      FROM images
    `).get() as any;

    return stats;
  },
};

// ─── Analysis Result Operations ──────────────────────────────────────

export const AnalysisModel = {
  /**
   * Insert a single analysis result.
   */
  create(data: {
    image_id: string;
    analyzer_name: string;
    passed: boolean;
    confidence?: number;
    details?: Record<string, any>;
    execution_time_ms?: number;
  }): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO analysis_results (image_id, analyzer_name, passed, confidence, details, execution_time_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      data.image_id,
      data.analyzer_name,
      data.passed ? 1 : 0,
      data.confidence ?? null,
      data.details ? JSON.stringify(data.details) : null,
      data.execution_time_ms ?? null
    );
  },

  /**
   * Batch insert analysis results within a transaction.
   */
  createBatch(results: Array<{
    image_id: string;
    analyzer_name: string;
    passed: boolean;
    confidence?: number;
    details?: Record<string, any>;
    execution_time_ms?: number;
  }>): void {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO analysis_results (image_id, analyzer_name, passed, confidence, details, execution_time_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((items: typeof results) => {
      for (const item of items) {
        stmt.run(
          item.image_id,
          item.analyzer_name,
          item.passed ? 1 : 0,
          item.confidence ?? null,
          item.details ? JSON.stringify(item.details) : null,
          item.execution_time_ms ?? null
        );
      }
    });

    insertMany(results);
    logger.debug('Batch inserted analysis results', { imageId: results[0]?.image_id, count: results.length });
  },

  /**
   * Find all analysis results for an image.
   */
  findByImageId(imageId: string): AnalysisResult[] {
    const db = getDb();
    return db.prepare('SELECT * FROM analysis_results WHERE image_id = ? ORDER BY created_at ASC')
      .all(imageId) as AnalysisResult[];
  },

  /**
   * Delete analysis results for an image (used before retry).
   */
  deleteByImageId(imageId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM analysis_results WHERE image_id = ?').run(imageId);
  },
};

// ─── Hash Operations ─────────────────────────────────────────────────

export const HashModel = {
  /**
   * Store image hash for duplicate detection.
   */
  create(data: {
    image_id: string;
    file_hash: string;
    perceptual_hash?: string;
  }): void {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO image_hashes (image_id, file_hash, perceptual_hash)
      VALUES (?, ?, ?)
    `).run(data.image_id, data.file_hash, data.perceptual_hash ?? null);
  },

  /**
   * Find images with matching file hash (exact duplicates).
   */
  findByFileHash(fileHash: string, excludeImageId?: string): ImageHash[] {
    const db = getDb();
    if (excludeImageId) {
      return db.prepare('SELECT * FROM image_hashes WHERE file_hash = ? AND image_id != ?')
        .all(fileHash, excludeImageId) as ImageHash[];
    }
    return db.prepare('SELECT * FROM image_hashes WHERE file_hash = ?')
      .all(fileHash) as ImageHash[];
  },

  /**
   * Find images with similar perceptual hash.
   * In a real system, this would use hamming distance.
   */
  findByPerceptualHash(pHash: string, excludeImageId?: string): ImageHash[] {
    const db = getDb();
    if (excludeImageId) {
      return db.prepare('SELECT * FROM image_hashes WHERE perceptual_hash = ? AND image_id != ?')
        .all(pHash, excludeImageId) as ImageHash[];
    }
    return db.prepare('SELECT * FROM image_hashes WHERE perceptual_hash = ?')
      .all(pHash) as ImageHash[];
  },

  /**
   * Get all hashes (for perceptual comparison).
   */
  getAll(excludeImageId?: string): ImageHash[] {
    const db = getDb();
    if (excludeImageId) {
      return db.prepare('SELECT * FROM image_hashes WHERE image_id != ?')
        .all(excludeImageId) as ImageHash[];
    }
    return db.prepare('SELECT * FROM image_hashes').all() as ImageHash[];
  },
};
