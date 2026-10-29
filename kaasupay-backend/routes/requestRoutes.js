// routes/requestRoutes.js — Route definitions for Day 7 Request Money.
import express from "express";
import {
  createRequest,
  getIncomingRequests,
  getOutgoingRequests,
  getRequestById,
  declineRequest,
  cancelRequest,
} from "../controllers/requestController.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimiter.js";

const router = express.Router();

// Rate limiter for request creation (Day 7 Level 5: at most 20 new requests an hour per user)
const requestCreateLimiter = rateLimit({
  name: "request_create",
  max: 20,
  windowSeconds: 3600,
  keyFrom: (req) => req.userId,
});

// All request routes require authenticated session
router.post("/", requireAuth, requestCreateLimiter, createRequest);
router.get("/incoming", requireAuth, getIncomingRequests);
router.get("/outgoing", requireAuth, getOutgoingRequests);
router.get("/:id", requireAuth, getRequestById);
router.post("/:id/decline", requireAuth, declineRequest);
router.post("/:id/cancel", requireAuth, cancelRequest);

export default router;
