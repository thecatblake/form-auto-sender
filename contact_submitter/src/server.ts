import express from "express";
import cors from "cors";
import path from "path";
import { repository } from "./repository";
import { logger } from "./logger";
import multer from "multer";
import fs from "fs";
import { FileTargetProvider } from "./target_provider";

const upload = multer({ dest: './public/data/uploads/' })

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// API Routes

// Get all profiles
app.get("/api/profiles", async (req, res) => {
    try {
        const profiles = await repository.getAllProfiles();
        res.json(profiles);
    } catch (e) {
        logger.error(`GET /api/profiles failed: ${e}`);
        res.status(500).json({ error: "Failed to fetch profiles" });
    }
});

// Create or update profile
app.post("/api/profiles", async (req, res) => {
    try {
        const { name, data } = req.body;
        if (!name || !data) {
            return res.status(400).json({ error: "Name and data are required" });
        }
        const id = await repository.saveProfile(name, data);
        res.json({ id, name, data });
    } catch (e) {
        logger.error(`POST /api/profiles failed: ${e}`);
        res.status(500).json({ error: "Failed to save profile" });
    }
});

// Delete profile
app.delete("/api/profiles/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const success = await repository.deleteProfile(id);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: "Profile not found" });
        }
    } catch (e) {
        logger.error(`DELETE /api/profiles/${req.params.id} failed: ${e}`);
        res.status(500).json({ error: "Failed to delete profile" });
    }
});

// Get submission logs
app.get("/api/logs", async (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 100;
        const offset = parseInt(req.query.offset as string) || 0;
        const logs = await repository.getLogs(limit, offset);
        res.json(logs);
    } catch (e) {
        logger.error(`GET /api/logs failed: ${e}`);
        res.status(500).json({ error: "Failed to fetch logs" });
    }
});

// Export logs as CSV
app.get("/api/logs/export", async (req, res) => {
    try {
        const logs = await repository.getLogs(10000, 0); // Get all logs (max 10000)

        // Create CSV header
        const csvHeader = "ID,送信時刻,HP,送信URL,結果,プロファイル名\n";

        // Create CSV rows
        const csvRows = logs.map(log => {
            const sentTime = new Date(log.sent_time).toLocaleString('ja-JP');
            return `${log.id},"${sentTime}","${log.root_url}","${log.sent_url}","${log.result}","${log.profile_name}"`;
        }).join('\n');

        const csv = csvHeader + csvRows;

        // Set headers for file download
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="submission_logs_${Date.now()}.csv"`);

        // Add BOM for Excel compatibility
        res.send('\uFEFF' + csv);
    } catch (e) {
        logger.error(`GET /api/logs/export failed: ${e}`);
        res.status(500).json({ error: "Failed to export logs" });
    }
});

// Get statistics
app.get("/api/stats", async (req, res) => {
    try {
        const stats = await repository.getStats();
        res.json(stats);
    } catch (e) {
        logger.error(`GET /api/stats failed: ${e}`);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

// Job tracking
interface JobStatus {
    id: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    totalUrls: number;
    processedUrls: number;
    successCount: number;
    failCount: number;
    profileName: string;
    startTime: Date;
    endTime?: Date;
    currentUrl?: string;
    logs: string[];
}

const activeJobs = new Map<string, JobStatus>();

// Get job status
app.get("/api/jobs/:jobId", async (req, res) => {
    try {
        const jobId = req.params.jobId;
        const job = activeJobs.get(jobId);

        if (!job) {
            return res.status(404).json({ error: "Job not found" });
        }

        res.json(job);
    } catch (e) {
        logger.error(`GET /api/jobs/${req.params.jobId} failed: ${e}`);
        res.status(500).json({ error: "Failed to fetch job status" });
    }
});

// Get all active jobs
app.get("/api/jobs", async (req, res) => {
    try {
        const jobs = Array.from(activeJobs.values());
        res.json(jobs);
    } catch (e) {
        logger.error(`GET /api/jobs failed: ${e}`);
        res.status(500).json({ error: "Failed to fetch jobs" });
    }
});

app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
        const { file } = req;
        if (!file) {
            return res.status(400).json({ error: "File is required" });
        }
        const filePath = file.path;
        const fileContent = fs.readFileSync(filePath, "utf-8");
        const urls = fileContent.split("\n").map(line => line.trim()).filter(line => line !== "");
        res.json({ urls, filePath });
    } catch (e) {
        logger.error(`POST /api/upload failed: ${e}`);
        res.status(500).json({ error: "Failed to upload file" });
    }
});

// Submit job
app.post("/api/submit-job", async (req, res) => {
    try {
        const { filePath, profileId } = req.body;

        if (!profileId) {
            return res.status(400).json({ error: "Profile ID is required" });
        }


        // Get profile from database
        const profiles = await repository.getAllProfiles();
        const profile = profiles.find(p => p.id === profileId);

        if (!profile) {
            return res.status(404).json({ error: "Profile not found" });
        }

        const targetProvider = new FileTargetProvider(filePath, profile);

        const targets = await targetProvider.getTargets();
        const urls = targets.map(t => t.url);

        // Create job ID
        const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Initialize job status
        const jobStatus: JobStatus = {
            id: jobId,
            status: 'running',
            totalUrls: urls.length,
            processedUrls: 0,
            successCount: 0,
            failCount: 0,
            profileName: profile.name,
            startTime: new Date(),
            logs: [`Job started with ${urls.length} URLs`]
        };

        activeJobs.set(jobId, jobStatus);

        logger.info(`Starting job ${jobId} with ${urls.length} URLs using profile ${profile.name}`);

        // Start job in background (don't await)
        const { runSubmissionJob } = await import("./job_runner");
        runSubmissionJob(urls, profile, jobStatus, (update) => {
            // Update callback
            const job = activeJobs.get(jobId);
            if (job) {
                Object.assign(job, update);
            }
        }).then(() => {
            const job = activeJobs.get(jobId);
            if (job) {
                job.status = 'completed';
                job.endTime = new Date();
                job.logs.push(`Job completed at ${job.endTime.toISOString()}`);
                logger.info(`Job ${jobId} completed`);
            }
        }).catch(e => {
            const job = activeJobs.get(jobId);
            if (job) {
                job.status = 'failed';
                job.endTime = new Date();
                job.logs.push(`Job failed: ${e.message}`);
                logger.error(`Job ${jobId} failed: ${e}`);
            }
        });

        res.json({
            success: true,
            jobId: jobId,
            message: `Job started with ${urls.length} URLs`,
            profileName: profile.name
        });
    } catch (e) {
        logger.error(`POST /api/submit-job failed: ${e}`);
        res.status(500).json({ error: "Failed to start job" });
    }
});

// Cancel/Stop a job
app.delete("/api/jobs/:jobId", async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = activeJobs.get(jobId);

        if (!job) {
            return res.status(404).json({ error: "Job not found" });
        }

        if (job.status !== 'running') {
            return res.status(400).json({ error: "Job is not running" });
        }

        // Mark job as cancelled
        job.status = 'cancelled';
        job.endTime = new Date();
        job.logs.push(`Job cancelled by user at ${job.endTime.toISOString()}`);

        logger.info(`Job ${jobId} cancelled by user`);

        res.json({
            message: "Job cancelled successfully",
            jobId: jobId
        });
    } catch (e: any) {
        logger.error(`DELETE /api/jobs/:jobId failed: ${e}`);
        res.status(500).json({ error: "Failed to cancel job" });
    }
});

app.listen(PORT, () => {
    logger.info(`GUI Server running at http://localhost:${PORT}`);
});
