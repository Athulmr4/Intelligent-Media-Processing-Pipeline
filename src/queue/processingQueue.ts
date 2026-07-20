import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { config } from '../config/env';

// ─── Types ───────────────────────────────────────────────────────────

export interface QueueJob {
  id: string;
  imageId: string;
  status: 'waiting' | 'active' | 'completed' | 'failed';
  retryCount: number;
  addedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

type JobHandler = (imageId: string) => Promise<void>;

// ─── In-Memory Processing Queue ──────────────────────────────────────
// 
// Design Decision: Using an in-memory queue instead of Redis/BullMQ
// for simplicity and zero external dependencies. In production, this
// should be replaced with BullMQ + Redis for:
//   - Persistence across restarts
//   - Distributed processing
//   - Better monitoring
//
// This implementation provides:
//   - Concurrency control
//   - Exponential backoff retries
//   - Dead letter tracking
//   - Event-driven status updates

export class ProcessingQueue extends EventEmitter {
  private queue: QueueJob[] = [];
  private activeJobs: Map<string, QueueJob> = new Map();
  private deadLetterQueue: QueueJob[] = [];
  private handler: JobHandler | null = null;
  private isProcessing = false;
  private concurrency: number;
  private maxRetries: number;
  private baseRetryDelay: number;

  constructor(options?: {
    concurrency?: number;
    maxRetries?: number;
    retryDelayMs?: number;
  }) {
    super();
    this.concurrency = options?.concurrency ?? config.queueConcurrency;
    this.maxRetries = options?.maxRetries ?? config.maxRetries;
    this.baseRetryDelay = options?.retryDelayMs ?? config.retryDelayMs;
  }

  /**
   * Register the job handler function.
   */
  process(handler: JobHandler): void {
    this.handler = handler;
    logger.info('Queue handler registered', {
      concurrency: this.concurrency,
      maxRetries: this.maxRetries,
    });
  }

  /**
   * Add a job to the queue.
   */
  add(imageId: string): QueueJob {
    const job: QueueJob = {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      imageId,
      status: 'waiting',
      retryCount: 0,
      addedAt: new Date(),
    };

    this.queue.push(job);
    logger.info('Job added to queue', {
      jobId: job.id,
      imageId,
      queueLength: this.queue.length,
    });

    this.emit('job:added', job);

    // Trigger processing on next tick to avoid blocking
    setImmediate(() => this.processNext());

    return job;
  }

  /**
   * Process the next available job(s) respecting concurrency limit.
   */
  private async processNext(): Promise<void> {
    if (!this.handler) {
      logger.warn('No handler registered, skipping processing');
      return;
    }

    // Fill up to concurrency limit
    while (this.activeJobs.size < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      job.status = 'active';
      job.startedAt = new Date();
      this.activeJobs.set(job.id, job);

      this.emit('job:started', job);
      logger.info('Processing job', {
        jobId: job.id,
        imageId: job.imageId,
        activeJobs: this.activeJobs.size,
      });

      // Process asynchronously
      this.executeJob(job);
    }
  }

  /**
   * Execute a single job with error handling and retry logic.
   */
  private async executeJob(job: QueueJob): Promise<void> {
    try {
      await this.handler!(job.imageId);

      job.status = 'completed';
      job.completedAt = new Date();
      this.activeJobs.delete(job.id);

      const duration = job.completedAt.getTime() - (job.startedAt?.getTime() || 0);
      logger.info('Job completed successfully', {
        jobId: job.id,
        imageId: job.imageId,
        durationMs: duration,
      });

      this.emit('job:completed', job);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      job.retryCount++;

      if (job.retryCount <= this.maxRetries) {
        // Schedule retry with exponential backoff
        const delay = this.baseRetryDelay * Math.pow(2, job.retryCount - 1);
        logger.warn('Job failed, scheduling retry', {
          jobId: job.id,
          imageId: job.imageId,
          retryCount: job.retryCount,
          maxRetries: this.maxRetries,
          retryDelayMs: delay,
          error: errorMessage,
        });

        job.status = 'waiting';
        this.activeJobs.delete(job.id);

        this.emit('job:retry', job);

        setTimeout(() => {
          this.queue.push(job);
          this.processNext();
        }, delay);
      } else {
        // Move to dead letter queue
        job.status = 'failed';
        job.error = errorMessage;
        job.completedAt = new Date();
        this.activeJobs.delete(job.id);
        this.deadLetterQueue.push(job);

        logger.error('Job permanently failed, moved to DLQ', {
          jobId: job.id,
          imageId: job.imageId,
          retries: job.retryCount,
          error: errorMessage,
        });

        this.emit('job:failed', job);
      }
    } finally {
      // Process next job in queue
      setImmediate(() => this.processNext());
    }
  }

  /**
   * Get queue statistics.
   */
  getStats(): {
    waiting: number;
    active: number;
    completed: number;
    deadLetterCount: number;
  } {
    return {
      waiting: this.queue.length,
      active: this.activeJobs.size,
      completed: 0, // We don't track completed jobs in memory to save space
      deadLetterCount: this.deadLetterQueue.length,
    };
  }

  /**
   * Get dead letter queue contents.
   */
  getDeadLetterQueue(): QueueJob[] {
    return [...this.deadLetterQueue];
  }

  /**
   * Graceful shutdown: wait for active jobs to complete.
   */
  async shutdown(timeoutMs = 30000): Promise<void> {
    logger.info('Queue shutting down...', {
      activeJobs: this.activeJobs.size,
      waitingJobs: this.queue.length,
    });

    if (this.activeJobs.size === 0) {
      return;
    }

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.activeJobs.size === 0) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          logger.info('Queue shutdown complete');
          resolve();
        }
      }, 500);

      const timeout = setTimeout(() => {
        clearInterval(checkInterval);
        logger.warn('Queue shutdown timed out', {
          remainingJobs: this.activeJobs.size,
        });
        resolve();
      }, timeoutMs);
    });
  }
}

// Singleton instance
export const processingQueue = new ProcessingQueue();
