import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env';
import { ImageModel } from '../models/image.model';
import { processingQueue } from '../queue/processingQueue';
import { logger } from '../utils/logger';

// ─── Multer Configuration ────────────────────────────────────────────

// Ensure upload directory exists
if (!fs.existsSync(config.uploadDir)) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, config.uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueId = uuidv4();
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uniqueId}${ext}`);
  },
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (config.allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: ${config.allowedMimeTypes.join(', ')}`));
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.maxFileSize,
    files: 1,
  },
});

// ─── Upload Controller ──────────────────────────────────────────────

export async function uploadImage(req: Request, res: Response): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: { message: 'No image file provided. Use form field "image".' },
      });
      return;
    }

    const file = req.file;
    const imageId = path.basename(file.filename, path.extname(file.filename));

    // Calculate file hash for quick duplicate pre-check
    const fileBuffer = fs.readFileSync(file.path);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Create database record
    const image = ImageModel.create({
      id: imageId,
      original_filename: file.originalname,
      stored_path: file.path,
      file_size: file.size,
      mime_type: file.mimetype,
      file_hash: fileHash,
    });

    // Enqueue for async processing
    const job = processingQueue.add(imageId);

    logger.info('Image uploaded successfully', {
      imageId,
      filename: file.originalname,
      size: file.size,
      jobId: job.id,
    });

    res.status(201).json({
      success: true,
      data: {
        id: image.id,
        status: image.status,
        filename: image.original_filename,
        fileSize: image.file_size,
        mimeType: image.mime_type,
        createdAt: image.created_at,
      },
      message: 'Image uploaded successfully. Processing will begin shortly.',
      _links: {
        status: `/api/v1/images/${image.id}/status`,
        results: `/api/v1/images/${image.id}/results`,
      },
    });
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    const message = error instanceof Error ? error.message : 'Upload failed';
    logger.error('Upload failed', { error: message });

    const statusCode = message.includes('Invalid file type') ? 400 : 500;
    res.status(statusCode).json({
      success: false,
      error: { message },
    });
  }
}
