// test/day10_phase6_5_config.test.js — AutoPay Production Configuration Hardening Test Suite
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env") });

const { validateApiConfig } = await import("../config.js");
const { verifyCronSecret } = await import("../controllers/cronController.js");

let passedAssertions = 0;
let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passedAssertions += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${name} -> ${detail}`);
  }
}

async function main() {
  console.log("===============================================================================");
  console.log("=== KAASUPAY DAY 10 PHASE 6.5: CONFIGURATION HARDENING REGRESSION SUITE ===");
  console.log("===============================================================================\n");

  // =========================================================================
  // Part 1: Production Validation Rules (validateApiConfig)
  // =========================================================================
  console.log("--- Part 1: Production Validation Rules ---");

  // Valid baseline production environment
  const validProdEnv = {
    NODE_ENV: "production",
    RAZORPAY_KEY_ID: "rzp_prod_key",
    RAZORPAY_KEY_SECRET: "rzp_prod_secret",
    RAZORPAY_WEBHOOK_SECRET: "rzp_prod_webhook",
    CRON_SECRET: "strong_production_cron_secret_12345",
    ALLOW_TIME_TRAVEL: "false",
  };

  // 1. Production with missing CRON_SECRET
  {
    let exitCode = null;
    const testEnv = { ...validProdEnv, CRON_SECRET: undefined };
    const ok = validateApiConfig(testEnv, (code) => { exitCode = code; });
    check("Production with missing CRON_SECRET fails validation", ok === false);
    check("Production with missing CRON_SECRET calls exit(1)", exitCode === 1);
  }

  // 2. Production with empty CRON_SECRET
  {
    let exitCode = null;
    const testEnv = { ...validProdEnv, CRON_SECRET: "   " };
    const ok = validateApiConfig(testEnv, (code) => { exitCode = code; });
    check("Production with empty CRON_SECRET fails validation", ok === false);
    check("Production with empty CRON_SECRET calls exit(1)", exitCode === 1);
  }

  // 3. Production with valid CRON_SECRET & ALLOW_TIME_TRAVEL="false"
  {
    let exitCode = null;
    const testEnv = { ...validProdEnv };
    const ok = validateApiConfig(testEnv, (code) => { exitCode = code; });
    check("Production with valid CRON_SECRET passes validation", ok === true);
    check("Exit function not called on valid production configuration", exitCode === null);
  }

  // 4. Production with ALLOW_TIME_TRAVEL="true"
  {
    let exitCode = null;
    const testEnv = { ...validProdEnv, ALLOW_TIME_TRAVEL: "true" };
    const ok = validateApiConfig(testEnv, (code) => { exitCode = code; });
    check("Production with ALLOW_TIME_TRAVEL='true' fails validation", ok === false);
    check("Production with ALLOW_TIME_TRAVEL='true' calls exit(1)", exitCode === 1);
  }

  // 5. Production with ALLOW_TIME_TRAVEL omitted / false
  {
    let exitCode = null;
    const testEnv = { ...validProdEnv, ALLOW_TIME_TRAVEL: undefined };
    const ok = validateApiConfig(testEnv, (code) => { exitCode = code; });
    check("Production with ALLOW_TIME_TRAVEL omitted passes validation", ok === true);
    check("Exit function not called when ALLOW_TIME_TRAVEL omitted", exitCode === null);
  }

  // =========================================================================
  // Part 2: Development & Test Environment Compatibility
  // =========================================================================
  console.log("\n--- Part 2: Development & Test Compatibility ---");

  // 6. Development environment without CRON_SECRET
  {
    let exitCode = null;
    const devEnv = { NODE_ENV: "development", ALLOW_TIME_TRAVEL: "false" };
    const ok = validateApiConfig(devEnv, (code) => { exitCode = code; });
    check("Development environment without CRON_SECRET passes validation", ok === true);
    check("Development exit function not called", exitCode === null);
  }

  // 7. Test environment with ALLOW_TIME_TRAVEL="true" and dynamic CRON_SECRET
  {
    let exitCode = null;
    const testEnv = { NODE_ENV: "test", ALLOW_TIME_TRAVEL: "true", CRON_SECRET: "dynamic_test_secret" };
    const ok = validateApiConfig(testEnv, (code) => { exitCode = code; });
    check("Test environment with ALLOW_TIME_TRAVEL='true' passes validation", ok === true);
    check("Test environment exit function not called", exitCode === null);
  }

  // 8. Test environment without CRON_SECRET or ALLOW_TIME_TRAVEL
  {
    let exitCode = null;
    const testEnv = { NODE_ENV: "test" };
    const ok = validateApiConfig(testEnv, (code) => { exitCode = code; });
    check("Test environment without CRON_SECRET passes validation", ok === true);
    check("Test exit function not called", exitCode === null);
  }

  // =========================================================================
  // Part 3: verifyCronSecret Security Guard
  // =========================================================================
  console.log("\n--- Part 3: verifyCronSecret Security Guard ---");

  // 9. verifyCronSecret fails closed when CRON_SECRET is missing
  {
    const prevSecret = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    const authed = verifyCronSecret("Bearer test_secret_token");
    check("verifyCronSecret returns false when CRON_SECRET is undefined", authed === false);
    if (prevSecret !== undefined) process.env.CRON_SECRET = prevSecret;
  }

  // 10. verifyCronSecret fails closed when CRON_SECRET is empty string
  {
    const prevSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "   ";
    const authed = verifyCronSecret("Bearer test_secret_token");
    check("verifyCronSecret returns false when CRON_SECRET is whitespace", authed === false);
    if (prevSecret !== undefined) process.env.CRON_SECRET = prevSecret;
  }

  // 11. verifyCronSecret succeeds with exact timingSafeEqual match
  {
    const prevSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "expected_super_secret_token";
    const authed = verifyCronSecret("Bearer expected_super_secret_token");
    check("verifyCronSecret returns true on valid Bearer secret", authed === true);

    const wrongAuthed = verifyCronSecret("Bearer wrong_secret_token");
    check("verifyCronSecret returns false on incorrect secret", wrongAuthed === false);
    if (prevSecret !== undefined) process.env.CRON_SECRET = prevSecret;
  }

  // =========================================================================
  // Part 4: Real Process Startup Termination Tests (Child Processes)
  // =========================================================================
  console.log("\n--- Part 4: Real Process Startup Termination Tests ---");

  // Test 12: Production with ALLOW_TIME_TRAVEL=true refuses startup
  {
    const child = spawn(process.execPath, ["-e", `
      import('dotenv/config').then(async () => {
        process.env.NODE_ENV = 'production';
        process.env.ALLOW_TIME_TRAVEL = 'true';
        process.env.CRON_SECRET = 'valid_secret_for_test';
        process.env.RAZORPAY_KEY_ID = 'id';
        process.env.RAZORPAY_KEY_SECRET = 'secret';
        process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook';
        const { validateApiConfig } = await import('./config.js');
        validateApiConfig();
      });
    `], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const code = await new Promise((r) => child.on("exit", r));
    check("Real process with ALLOW_TIME_TRAVEL=true in production exits with code 1", code === 1);
    check("Process emits configuration error for ALLOW_TIME_TRAVEL", stderr.includes("ALLOW_TIME_TRAVEL cannot be enabled in production"));
  }

  // Test 13: Production with missing CRON_SECRET refuses startup
  {
    const child = spawn(process.execPath, ["-e", `
      import('dotenv/config').then(async () => {
        process.env.NODE_ENV = 'production';
        process.env.ALLOW_TIME_TRAVEL = 'false';
        delete process.env.CRON_SECRET;
        process.env.RAZORPAY_KEY_ID = 'id';
        process.env.RAZORPAY_KEY_SECRET = 'secret';
        process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook';
        const { validateApiConfig } = await import('./config.js');
        validateApiConfig();
      });
    `], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const code = await new Promise((r) => child.on("exit", r));
    check("Real process with missing CRON_SECRET in production exits with code 1", code === 1);
    check("Process emits configuration error for CRON_SECRET", stderr.includes("Missing or empty CRON_SECRET in production"));
  }

  // Test 14: Development mode starts cleanly without CRON_SECRET
  {
    const child = spawn(process.execPath, ["-e", `
      import('dotenv/config').then(async () => {
        process.env.NODE_ENV = 'development';
        delete process.env.CRON_SECRET;
        process.env.ALLOW_TIME_TRAVEL = 'false';
        const { validateApiConfig } = await import('./config.js');
        validateApiConfig();
        console.log('DEV_BOOT_OK');
      });
    `], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    const code = await new Promise((r) => child.on("exit", r));
    check("Real process in development without CRON_SECRET exits with code 0", code === 0);
    check("Development process outputs DEV_BOOT_OK", stdout.includes("DEV_BOOT_OK"));
  }

  console.log("\n===============================================================================");
  console.log(`=== DAY 10 PHASE 6.5 TEST SUMMARY: ${passedAssertions} PASSED, ${failures} FAILED ===`);
  console.log("===============================================================================");

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
