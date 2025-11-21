import { query } from "./db";
import { logger } from "./logger";

export class Repository {
    async saveProfile(name: string, data: any): Promise<number> {
        try {
            // Check if profile exists
            const existing = await query<{ id: number }>(
                "SELECT id FROM profiles WHERE name = $1",
                [name]
            );

            if (existing.length > 0) {
                // Update
                await query(
                    "UPDATE profiles SET data = $2 WHERE id = $1",
                    [existing[0].id, JSON.stringify(data)]
                );
                return existing[0].id;
            } else {
                // Insert
                const res = await query<{ id: number }>(
                    "INSERT INTO profiles (name, data) VALUES ($1, $2) RETURNING id",
                    [name, JSON.stringify(data)]
                );
                return res[0].id;
            }
        } catch (e) {
            logger.error(`Failed to save profile: ${e}`);
            throw e;
        }
    }

    async logSubmission(rootUrl: string, sentUrl: string, result: string, profileName: string): Promise<void> {
        try {
            await query(
                "INSERT INTO submission_logs (root_url, sent_url, result, profile_name) VALUES ($1, $2, $3, $4)",
                [rootUrl, sentUrl, result, profileName]
            );
        } catch (e) {
            logger.error(`Failed to log submission: ${e}`);
            // Don't throw, just log error to avoid stopping the process
        }
    }

    async getAllProfiles(): Promise<Array<{ id: number; name: string; data: any; created_at: string }>> {
        try {
            const profiles = await query<{ id: number; name: string; data: string; created_at: string }>(
                "SELECT id, name, data, created_at FROM profiles ORDER BY created_at DESC"
            );
            return profiles.map(p => ({
                ...p,
                data: typeof p.data === 'string' ? JSON.parse(p.data) : p.data
            }));
        } catch (e) {
            logger.error(`Failed to get profiles: ${e}`);
            return [];
        }
    }

    async deleteProfile(id: number): Promise<boolean> {
        try {
            await query("DELETE FROM profiles WHERE id = $1", [id]);
            return true;
        } catch (e) {
            logger.error(`Failed to delete profile: ${e}`);
            return false;
        }
    }

    async getLogs(limit: number = 100, offset: number = 0): Promise<Array<any>> {
        try {
            return await query(
                "SELECT * FROM submission_logs ORDER BY sent_time DESC LIMIT $1 OFFSET $2",
                [limit, offset]
            );
        } catch (e) {
            logger.error(`Failed to get logs: ${e}`);
            return [];
        }
    }

    async getStats(): Promise<{ total: number; success: number; fail: number; pending: number }> {
        try {
            const result = await query<{ result: string; count: string }>(
                "SELECT result, COUNT(*) as count FROM submission_logs GROUP BY result"
            );
            const stats = { total: 0, success: 0, fail: 0, pending: 0 };
            result.forEach(r => {
                const count = parseInt(r.count);
                stats.total += count;
                if (r.result === 'success') stats.success = count;
                else if (r.result === 'fail') stats.fail = count;
                else if (r.result === 'pending') stats.pending = count;
            });
            return stats;
        } catch (e) {
            logger.error(`Failed to get stats: ${e}`);
            return { total: 0, success: 0, fail: 0, pending: 0 };
        }
    }

    /**
     * Check if a URL has already been successfully submitted
     * @param rootUrl The root URL to check
     * @returns true if the URL has been successfully submitted, false otherwise
     */
    async isUrlSubmitted(rootUrl: string): Promise<boolean> {
        try {
            const result = await query<{ count: string }>(
                "SELECT COUNT(*) as count FROM submission_logs WHERE root_url = $1 AND result = 'success'",
                [rootUrl]
            );
            return parseInt(result[0].count) > 0;
        } catch (e) {
            logger.error(`Failed to check if URL is submitted: ${e}`);
            return false; // If error, assume not submitted to be safe
        }
    }

    /**
     * Get list of URLs that have not been successfully submitted yet
     * @param urls List of URLs to filter
     * @returns List of URLs that haven't been successfully submitted
     */
    async filterUnsubmittedUrls(urls: string[]): Promise<string[]> {
        try {
            const placeholders = urls.map((_, i) => `$${i + 1}`).join(',');
            const result = await query<{ root_url: string }>(
                `SELECT DISTINCT root_url FROM submission_logs WHERE root_url IN (${placeholders})`,
                urls
            );
            const submittedUrls = new Set(result.map(r => r.root_url));
            return urls.filter(url => !submittedUrls.has(url));
        } catch (e) {
            logger.error(`Failed to filter unsubmitted URLs: ${e}`);
            return urls; // If error, return all URLs to be safe
        }
    }
}

export const repository = new Repository();

