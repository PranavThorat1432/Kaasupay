// Load .env BEFORE any module reads process.env (config.js validates it).
import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { PORT, CLIENT_URL, validateApiConfig } from "./config.js";
import { connectDB } from "./db.js";
import apiRouter from "./routes/index.js";
import { PayoutWorker } from "./worker.js";

// Validate API-specific configuration (fails fast in production if payment secrets are missing).
validateApiConfig();

const app = express();

let server = null;
let workerInstance = null;
let isShuttingDown = false;

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

/**
 * Health check endpoint - reports API, MongoDB, and Worker status.
 * Returns HTTP 200 when healthy, HTTP 503 when degraded or dependencies are disconnected.
 */
export function getHealthStatus() {
  const isDbConnected = mongoose.connection.readyState === 1;
  const workerStatus = workerInstance ? workerInstance.getStatus() : null;

  // If worker is running in this process, it must be active and making progress
  const isWorkerHealthy = !workerInstance || (workerStatus && workerStatus.running && workerStatus.loopAlive);
  const isHealthy = isDbConnected && isWorkerHealthy && !isShuttingDown;

  const payload = {
    status: isHealthy ? "KaasuPay backend is running" : "Service Unavailable",
    api: {
      status: isShuttingDown ? "shutting_down" : (isHealthy ? "healthy" : "unhealthy"),
      uptimeSeconds: Math.floor(process.uptime()),
    },
    database: {
      status: isDbConnected ? "connected" : "disconnected",
    },
    worker: workerStatus
      ? {
          status: workerStatus.running ? "running" : "stopped",
          loopAlive: workerStatus.loopAlive,
          pollCount: workerStatus.pollCount,
          lastPollAt: workerStatus.lastPollAt,
        }
      : { status: "disabled" },
  };

  return { isHealthy, statusCode: isHealthy ? 200 : 503, payload };
}

app.get(["/", "/health", "/healthz"], (req, res) => {
  const { statusCode, payload } = getHealthStatus();
  return res.status(statusCode).json(payload);
});

// All versioned API routes hang off /api/v1.
app.use("/api/v1", apiRouter);

// Graceful shutdown: stops worker loop, closes HTTP listener, disconnects database
export async function stopServer() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  if (workerInstance) {
    workerInstance.stop();
  }

  if (server) {
    await new Promise((resolve) => server.close(resolve));
    console.log("[server] HTTP server closed.");
  }

  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log("[server] MongoDB connection closed.");
    }
  } catch (err) {
    console.error("[server] Error disconnecting MongoDB:", err.message);
  }
}

async function handleSignal(signal) {
  console.log(`\n[server] Received ${signal}. Gracefully shutting down...`);
  await stopServer();
  process.exit(0);
}

process.on("SIGINT", () => handleSignal("SIGINT"));
process.on("SIGTERM", () => handleSignal("SIGTERM"));
if (process.send) {
  process.on("message", (msg) => {
    if (msg === "shutdown" || msg === "SIGTERM" || msg === "SIGINT") {
      handleSignal(msg === "shutdown" ? "SIGTERM" : msg);
    }
  });
}

export function getWorkerInstance() {
  return workerInstance;
}

// Startup order is deliberate: dotenv → config → MongoDB → Worker → listen.
// The server never accepts requests before the database connection succeeds
// (connectDB exits the process if the connection fails).
export async function startServer() {
  await connectDB();

  // Start the background payout worker alongside Express within this single process
  if (process.env.DISABLE_WORKER !== "true") {
    workerInstance = new PayoutWorker();
    workerInstance.start().catch((err) => {
      console.error("[worker] Unhandled worker loop error:", err.message);
    });
  }

  return new Promise((resolve) => {
    server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      resolve({ app, server, worker: workerInstance });
    });
  });
}

// Self-invoking runner when executed directly via node index.js
if (
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("index.js")
) {
  startServer();
}

export default app;
