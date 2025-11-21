import { repository } from "./repository";
import { query, pool } from "./db";
import { logger } from "./logger";

async function test() {
    logger.info("Testing database logging...");

    const profileName = "Test Profile " + Date.now();
    const profileData = { test: "data" };

    // Test saveProfile
    const profileId = await repository.saveProfile(profileName, profileData);
    logger.info(`Saved profile with ID: ${profileId}`);

    // Verify profile
    const profiles = await query<{ id: number, name: string }>("SELECT * FROM profiles WHERE id = $1", [profileId]);
    if (profiles.length === 1 && profiles[0].name === profileName) {
        logger.info("Profile verification passed");
    } else {
        logger.error("Profile verification failed");
    }

    // Test logSubmission
    const rootUrl = "http://example.com";
    const sentUrl = "http://example.com/contact";
    const result = "success";

    await repository.logSubmission(rootUrl, sentUrl, result, profileName);
    logger.info("Logged submission");

    // Verify submission log
    const logs = await query<{ id: number, root_url: string, result: string }>("SELECT * FROM submission_logs WHERE profile_name = $1 ORDER BY id DESC LIMIT 1", [profileName]);
    if (logs.length === 1 && logs[0].root_url === rootUrl && logs[0].result === result) {
        logger.info("Submission log verification passed");
    } else {
        logger.error("Submission log verification failed");
    }

    await pool.end();
}

test();
