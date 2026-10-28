import "dotenv/config";
import http from "node:http";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { PORT, CLIENT_URL, BANK_URL, validateApiConfig } from "./config.js";
import { connectDB } from "./db.js";
import apiRouter from "./routes/index.js";
import { PayoutWorker } from "./worker.js";
import { createFakeBankApp } from "./tools/fake-bank.js";

// Validate API-specific configuration (fails fast in production if payment secrets are missing).
validateApiConfig();

const app = express();

let server = null;
let workerInstance = null;
let bankServerInstance = null;
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
    bank: {
      url: BANK_URL,
      embeddedRunning: Boolean(bankServerInstance),
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

/**
 * Automatically starts the embedded fake bank simulator if BANK_URL targets
 * localhost and no external bank process is already listening on that port.
 */
export async function ensureFakeBankRunning() {
  if (process.env.DISABLE_BANK === "true") return null;

  try {
    const bankUrlObj = new URL(BANK_URL);
    const isLocal =
      bankUrlObj.hostname === "localhost" ||
      bankUrlObj.hostname === "127.0.0.1" ||
      bankUrlObj.hostname === "0.0.0.0";

    if (!isLocal && process.env.AUTO_START_BANK !== "true") {
      return null;
    }

    const targetPort = parseInt(
      bankUrlObj.port || process.env.FAKE_BANK_PORT || "4000",
      10
    );

    // Probe if a bank service is already responding
    const isAlreadyRunning = await new Promise((resolve) => {
      const probe = http.get(`${BANK_URL}/health`, (res) => {
        resolve(res.statusCode < 500);
      });
      probe.on("error", () => resolve(false));
      probe.setTimeout(300, () => {
        probe.destroy();
        resolve(false);
      });
    });

    if (isAlreadyRunning) {
      return null;
    }

    const { app: fakeBankApp } = createFakeBankApp();
    return new Promise((resolve) => {
      const bServer = fakeBankApp.listen(targetPort, "0.0.0.0", () => {
        console.log(`[bank] Fake bank simulator started on http://localhost:${targetPort}`);
        bankServerInstance = bServer;
        resolve(bServer);
      });
      bServer.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          console.log(`[bank] Port ${targetPort} already in use, using existing listener.`);
        } else {
          console.warn(`[bank] Could not start embedded fake bank: ${err.message}`);
        }
        resolve(null);
      });
    });
  } catch (err) {
    console.warn(`[bank] Error verifying fake bank: ${err.message}`);
    return null;
  }
}

// Graceful shutdown: stops worker loop, closes HTTP listener, disconnects database
export async function stopServer() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  if (workerInstance) {
    workerInstance.stop();
  }

  if (bankServerInstance) {
    await new Promise((resolve) => bankServerInstance.close(resolve));
    console.log("[server] Fake bank simulator closed.");
    bankServerInstance = null;
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

export function getBankServerInstance() {
  return bankServerInstance;
}

// Startup order is deliberate: dotenv → config → MongoDB → Fake Bank → Worker → listen.
// The server never accepts requests before the database connection succeeds
// (connectDB exits the process if the connection fails).
export async function startServer() {
  await connectDB();

  // Ensure fake bank is reachable for withdrawals when configured for localhost
  await ensureFakeBankRunning();

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
      resolve({ app, server, worker: workerInstance, bankServer: bankServerInstance });
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
