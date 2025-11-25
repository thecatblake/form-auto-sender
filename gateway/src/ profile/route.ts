// src/routes/profileRouter.ts
import { Router, Request, Response } from "express";
import {
  createSubmitProfile,
  updateSubmitProfile,
  getSubmitProfile,
  listSubmitProfiles,
} from "./api";

const router = Router();

/**
 * GET /profiles
 * プロファイル一覧を取得
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const profiles = await listSubmitProfiles();
    res.json(profiles);
  } catch (err) {
    console.error("Error listing profiles", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /profiles/:id
 * プロファイル1件取得
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const profile = await getSubmitProfile(id);

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    res.json(profile);
  } catch (err) {
    console.error("Error getting profile", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /profiles
 * プロファイル作成
 * body: { name: string; body?: string }
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, body } = req.body;

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "name is required" });
    }

    const profile = await createSubmitProfile({ name, body });
    res.status(201).json(profile);
  } catch (err) {
    console.error("Error creating profile", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /profiles/:id
 * プロファイル更新（部分更新）
 * body: { name?: string; body?: string }
 */
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, body } = req.body;

    if (name === undefined && body === undefined) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const updated = await updateSubmitProfile({ id, name, body });

    if (!updated) {
      return res.status(404).json({ error: "Profile not found" });
    }

    res.json(updated);
  } catch (err) {
    console.error("Error updating profile", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
