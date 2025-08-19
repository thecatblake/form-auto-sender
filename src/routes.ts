import { Router, Request, Response } from "express";
import { ContactData } from "./types";
import { findContactPageUrl, submitContactForm } from "./crawler";

export const router = Router();

// ---- API endpoints ----

// POST /api/submit-contact-form
router.post("/submit-contact-form", async (req: Request, res: Response) => {
  try {
    const { url, data } = req.body as { url: string; data: ContactData };
    if (!url) return res.status(400).json({ error: "Missing url" });

    const result = await submitContactForm(url, data);
    res.json({ result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Server error" });
  }
});

// GET /api/find-contact-page?url=...
router.get("/find-contact-page", async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    if (!url) return res.status(400).json({ error: "Missing url" });

    const result = await findContactPageUrl(url);
    res.json({ result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Server error" });
  }
});
