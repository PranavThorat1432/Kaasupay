import express from "express";
import {
  createMandate,
  listMandates,
  getMandateRuns,
  pauseMandate,
  resumeMandate,
  cancelMandate,
} from "../controllers/autopayController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

// All mandate endpoints require user authentication
router.post("/", requireAuth, createMandate);
router.get("/", requireAuth, listMandates);
router.get("/:id/runs", requireAuth, getMandateRuns);
router.post("/:id/pause", requireAuth, pauseMandate);
router.post("/:id/resume", requireAuth, resumeMandate);
router.post("/:id/cancel", requireAuth, cancelMandate);

export default router;
