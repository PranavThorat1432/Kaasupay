// tools/fake-bank.js
// FAKE BANK: a pretend bank payout API for testing KaasuPay withdrawals.
// Run it in its own terminal: node tools/fake-bank.js (listens on port 4000)
// Change how it behaves: POST http://localhost:4000/mode body {"mode":"flaky"}
// normal : pays after 0.3 s
// flaky  : 50% of calls fail with 503 (try again later)
// slow   : takes 10 s to answer, but DOES pay (a repeat call meanwhile gets status PROCESSING)
// down   : every call fails with 503
// An account number ending in 0000 is a closed account: the bank refuses it for good.

import "dotenv/config";
import express from "express";

export function createFakeBankApp() {
  const app = express();
  app.use(express.json());

  let mode = "normal";
  const payouts = new Map(); // reference -> result. The bank remembers every reference.
  const calls = {}; // reference -> how many times KaasuPay called
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Health check endpoint for monitoring and startup verification
  app.get(["/", "/health", "/healthz"], (req, res) => {
    res.json({
      status: "ok",
      service: "fake-bank",
      mode,
      paid: [...payouts.values()].filter((p) => p.status === "SUCCESS").length,
    });
  });

  app.post("/mode", (req, res) => {
    mode = req.body?.mode || "normal";
    console.log("[bank] mode is now", mode);
    res.json({ mode });
  });

  app.post("/payouts", async (req, res) => {
    const { reference, accountNumber, ifsc, amount } = req.body || {};
    calls[reference] = (calls[reference] || 0) + 1;
    console.log(
      `[bank] call ${calls[reference]} for ${reference} (mode ${mode})`
    );

    if (!reference || !accountNumber || !ifsc || !Number.isInteger(amount)) {
      return res.status(400).json({
        error: "reference, accountNumber, ifsc and amount are required",
      });
    }

    // Same reference again? Give back the SAME result. Never pay twice.
    if (payouts.has(reference)) {
      const known = payouts.get(reference);
      if (known.status === "PROCESSING") {
        return res.status(202).json(known);
      }
      return res.json({ ...known, duplicate: true });
    }

    if (mode === "down") {
      return res.status(503).json({ error: "Bank is down. Try later." });
    }

    if (mode === "flaky" && Math.random() < 0.5) {
      return res.status(503).json({ error: "Temporary error. Try later." });
    }

    payouts.set(reference, { reference, status: "PROCESSING" }); // claimed: repeats now get PROCESSING
    const slowDelay = process.env.SLOW_BANK_DELAY_MS
      ? parseInt(process.env.SLOW_BANK_DELAY_MS, 10)
      : 10000;
    await sleep(mode === "slow" ? slowDelay : 300);

    const result = accountNumber.endsWith("0000")
      ? { reference, status: "FAILED", reason: "Account closed" }
      : { reference, status: "SUCCESS", bankRef: "UTR" + Date.now() };

    payouts.set(reference, result);
    console.log(`[bank] ${reference} -> ${result.status}`);
    res.json(result);
  });

  app.get("/payouts/:reference", (req, res) => {
    const r = payouts.get(req.params.reference);
    if (!r) {
      return res.status(404).json({ error: "No payout with this reference" });
    }
    res.json(r);
  });

  app.get("/stats", (req, res) => {
    res.json({
      mode,
      calls,
      paid: [...payouts.values()].filter((p) => p.status === "SUCCESS").length,
    });
  });

  app.post("/reset", (req, res) => {
    mode = "normal";
    payouts.clear();
    for (const k of Object.keys(calls)) delete calls[k];
    res.json({ message: "Reset complete" });
  });

  return { app, getMode: () => mode, setMode: (m) => (mode = m), payouts, calls };
}

// Standalone runner
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("tools/fake-bank.js")) {
  const { app } = createFakeBankApp();
  const PORT = parseInt(
    process.env.FAKE_BANK_PORT ||
      (process.env.PORT && process.env.PORT !== "3000" ? process.env.PORT : "4000"),
    10
  );
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[bank] Fake bank running on http://localhost:${PORT}`);
  });
}
