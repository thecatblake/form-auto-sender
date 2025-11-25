import { Router, Request, Response } from "express";
import {
  createSubmissionResult,
  listSubmission
} from "./api";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
	const profiles = await listSubmission();
	res.json(profiles);
  } catch (err) {
	console.error("Error listing profiles", err);
	res.status(500).json({ error: "Internal server error" });
  }
});


router.post("/", async (req: Request, res: Response) => {
  try {
    const { profile_id, host, contact_url, result } = req.body;

    if (!profile_id || typeof profile_id !== "string") {
      return res.status(400).json({ error: "profile_id is required" });
    }

    const submission = await createSubmissionResult({
      profile_id,
      host,
      contact_url,
      result,
    });

    res.status(201).json(submission);
  } catch (err) {
    console.error("Error creating submission", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;