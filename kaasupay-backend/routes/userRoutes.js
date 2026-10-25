import express from "express";
import {
  signup,
  signin,
  getMe,
  updateProfile,
  bulkSearch,
  setPin,
  logoutAll,
} from "../controllers/userController.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { rateLimit } from "../middleware/rateLimiter.js";

const router = express.Router();

// Rate limiters as per Day 6 specification
const signinEmailLimiter = rateLimit({
  name: "signin_email",
  max: 5,
  windowSeconds: 60,
  keyFrom: (req) => req.body?.username,
});

const signinIpLimiter = rateLimit({
  name: "signin_ip",
  max: 20,
  windowSeconds: 60,
  keyFrom: (req) => req.ip,
});

const signupIpLimiter = rateLimit({
  name: "signup_ip",
  max: 10,
  windowSeconds: 3600,
  keyFrom: (req) => req.ip,
});

const pinUserLimiter = rateLimit({
  name: "pin_user",
  max: 5,
  windowSeconds: 3600,
  keyFrom: (req) => req.userId,
});

router.post("/signup", signupIpLimiter, signup);
router.post("/signin", signinIpLimiter, signinEmailLimiter, signin);

router.get("/me", requireAuth, getMe);
router.put("/", requireAuth, updateProfile);
router.get("/bulk", requireAuth, bulkSearch);

router.post("/pin", requireAuth, pinUserLimiter, setPin);
router.post("/logout-all", requireAuth, logoutAll);

export default router;
