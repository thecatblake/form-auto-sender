import { query, pool } from "./db";
import { logger } from "./logger";

async function migrate() {
    logger.info("Starting migration...");

    try {
        // Create profiles table
        await query(`
            CREATE TABLE IF NOT EXISTS profiles (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                data JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        logger.info("Created profiles table (if not exists)");

        // Create submission_logs table
        await query(`
            CREATE TABLE IF NOT EXISTS submission_logs (
                id SERIAL PRIMARY KEY,
                root_url TEXT NOT NULL,
                sent_url TEXT NOT NULL,
                sent_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                result TEXT NOT NULL,
                profile_name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        logger.info("Created submission_logs table (if not exists)");

    } catch (e) {
        logger.error(`Migration failed: ${e}`);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
