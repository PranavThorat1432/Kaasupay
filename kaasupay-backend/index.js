// Load .env BEFORE any module reads process.env (config.js validates it).
import "dotenv/config";
import express from "express";
import cors from "cors";
import { PORT, CLIENT_URL, validateApiConfig } from "./config.js";
import { connectDB } from "./db.js";
import apiRouter from "./routes/index.js";

// Validate API-specific configuration (fails fast in production if payment secrets are missing).
validateApiConfig();

const app = express();

// Trust reverse proxy (NGINX, Render, Railway) for accurate client IPs in rate limiting
app.set("trust proxy", 1);

// Configure CORS for the frontend origin.
app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  })
);

// Identify which backend instance handled the request.
app.use((req, res, next) => {
  res.setHeader(
    "X-Served-By",
    process.env.INSTANCE_NAME || "unknown"
  );

  next();
});


// Webhook raw-body middleware must run BEFORE express.json() so that
// exact raw bytes are preserved for HMAC-SHA256 signature verification.
app.use("/api/v1/webhooks/razorpay", express.raw({ type: "application/json" }));

// Parse JSON request bodies.
app.use(express.json());

// Health check - confirms the server is up before any API call.
app.get("/", (req, res) => {
  res.json({ status: "KaasuPay backend is running" });
});

// All versioned API routes hang off /api/v1.
app.use("/api/v1", apiRouter);

// Startup order is deliberate: dotenv → config → MongoDB → listen.
// The server never accepts requests before the database connection succeeds
// (connectDB exits the process if the connection fails).
async function startServer() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
