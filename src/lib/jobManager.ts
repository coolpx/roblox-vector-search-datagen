import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Job {
    id: string;
    command: string;
    status: JobStatus;
    progress_current?: number;
    progress_total?: number;
    progress_message?: string;
    result?: string; // JSON string
    error?: string;
    created_at: Date;
    started_at?: Date;
    completed_at?: Date;
}

export interface JobProgress {
    current: number;
    total: number;
    message?: string;
}

class JobManager extends EventEmitter {
    private db: Database.Database;

    constructor() {
        super();

        // Ensure data directory exists
        const dataDir = path.join(process.cwd(), 'data');
        fs.mkdirSync(dataDir, { recursive: true });

        const dbPath = path.join(dataDir, 'jobs.db');
        this.db = new Database(dbPath);

        this.initializeDatabase();
    }

    private initializeDatabase() {
        // Create jobs table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                command TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
                progress_current INTEGER,
                progress_total INTEGER,
                progress_message TEXT,
                result TEXT,
                error TEXT,
                created_at DATETIME NOT NULL,
                started_at DATETIME,
                completed_at DATETIME
            )
        `);

        // Create indexes for better performance
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
            CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_jobs_command ON jobs(command);
        `);
    }

    createJob(command: string): string {
        const id = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const stmt = this.db.prepare(`
            INSERT INTO jobs (id, command, status, created_at)
            VALUES (?, ?, 'pending', datetime('now'))
        `);

        stmt.run(id, command);
        return id;
    }

    getJob(id: string): Job | undefined {
        const stmt = this.db.prepare(`
            SELECT * FROM jobs WHERE id = ?
        `);

        const row = stmt.get(id) as any;
        if (!row) return undefined;

        return this.mapRowToJob(row);
    }

    getAllJobs(limit = 100, offset = 0): Job[] {
        const stmt = this.db.prepare(`
            SELECT * FROM jobs 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `);

        const rows = stmt.all(limit, offset) as any[];
        return rows.map(row => this.mapRowToJob(row));
    }

    getJobsByStatus(status: JobStatus): Job[] {
        const stmt = this.db.prepare(`
            SELECT * FROM jobs 
            WHERE status = ? 
            ORDER BY created_at DESC
        `);

        const rows = stmt.all(status) as any[];
        return rows.map(row => this.mapRowToJob(row));
    }

    getJobsByCommand(command: string): Job[] {
        const stmt = this.db.prepare(`
            SELECT * FROM jobs 
            WHERE command = ? 
            ORDER BY created_at DESC
        `);

        const rows = stmt.all(command) as any[];
        return rows.map(row => this.mapRowToJob(row));
    }

    updateJob(id: string, updates: Partial<Job>) {
        const job = this.getJob(id);
        if (!job) return;

        // Build dynamic update query
        const fields: string[] = [];
        const values: any[] = [];

        if (updates.status !== undefined) {
            fields.push('status = ?');
            values.push(updates.status);
        }

        if (updates.progress_current !== undefined) {
            fields.push('progress_current = ?');
            values.push(updates.progress_current);
        }

        if (updates.progress_total !== undefined) {
            fields.push('progress_total = ?');
            values.push(updates.progress_total);
        }

        if (updates.progress_message !== undefined) {
            fields.push('progress_message = ?');
            values.push(updates.progress_message);
        }

        if (updates.result !== undefined) {
            fields.push('result = ?');
            values.push(
                typeof updates.result === 'string' ? updates.result : JSON.stringify(updates.result)
            );
        }

        if (updates.error !== undefined) {
            fields.push('error = ?');
            values.push(updates.error);
        }

        if (updates.started_at !== undefined) {
            fields.push('started_at = ?');
            values.push(updates.started_at ? updates.started_at.toISOString() : null);
        }

        if (updates.completed_at !== undefined) {
            fields.push('completed_at = ?');
            values.push(updates.completed_at ? updates.completed_at.toISOString() : null);
        }

        if (fields.length === 0) return;

        values.push(id);

        const stmt = this.db.prepare(`
            UPDATE jobs 
            SET ${fields.join(', ')} 
            WHERE id = ?
        `);

        stmt.run(...values);

        // Get updated job and emit event
        const updatedJob = this.getJob(id);
        if (updatedJob) {
            this.emit('jobUpdated', updatedJob);
        }
    }

    updateJobProgress(id: string, progress: JobProgress) {
        this.updateJob(id, {
            progress_current: progress.current,
            progress_total: progress.total,
            progress_message: progress.message
        });
    }

    deleteJob(id: string): boolean {
        const stmt = this.db.prepare('DELETE FROM jobs WHERE id = ?');
        const result = stmt.run(id);
        return result.changes > 0;
    }

    deleteOldJobs(olderThanDays = 30): number {
        const stmt = this.db.prepare(`
            DELETE FROM jobs 
            WHERE created_at < datetime('now', '-' || ? || ' days')
        `);
        const result = stmt.run(olderThanDays);
        return result.changes;
    }

    getJobStats() {
        const stmt = this.db.prepare(`
            SELECT 
                status,
                COUNT(*) as count
            FROM jobs 
            GROUP BY status
        `);

        const rows = stmt.all() as { status: JobStatus; count: number }[];

        const stats = {
            pending: 0,
            running: 0,
            completed: 0,
            failed: 0,
            total: 0
        };

        for (const row of rows) {
            stats[row.status] = row.count;
            stats.total += row.count;
        }

        return stats;
    }

    async runJob(id: string, commandFn: () => Promise<any>): Promise<void> {
        const job = this.getJob(id);
        if (!job) return;

        this.updateJob(id, {
            status: 'running',
            started_at: new Date()
        });

        try {
            const result = await commandFn();
            this.updateJob(id, {
                status: 'completed',
                completed_at: new Date(),
                result: result
            });
        } catch (error) {
            this.updateJob(id, {
                status: 'failed',
                completed_at: new Date(),
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    private mapRowToJob(row: any): Job {
        return {
            id: row.id,
            command: row.command,
            status: row.status as JobStatus,
            progress_current: row.progress_current,
            progress_total: row.progress_total,
            progress_message: row.progress_message,
            result: row.result ? JSON.parse(row.result) : undefined,
            error: row.error,
            created_at: new Date(row.created_at),
            started_at: row.started_at ? new Date(row.started_at) : undefined,
            completed_at: row.completed_at ? new Date(row.completed_at) : undefined
        };
    }

    close() {
        this.db.close();
    }
}

export const jobManager = new JobManager();

// Graceful shutdown
process.on('SIGINT', () => {
    jobManager.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    jobManager.close();
    process.exit(0);
});
