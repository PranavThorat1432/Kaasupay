import mongoose from "mongoose";
import { MONGO_URL } from "./config.js";

export function resolveDbName(mongoUrl, envDbName) {
  try {
    const sanitized = mongoUrl.replace(/^mongodb(\+srv)?:\/\//, "http://");
    const parsed = new URL(sanitized);
    const pathDb = parsed.pathname ? parsed.pathname.replace(/^\//, "").split("?")[0] : "";
    if (pathDb) return pathDb;
  } catch {
    // If URL parsing fails, fall through to environment or default
  }
  return envDbName || "kaasupay";
}

export async function connectDB() {
  try {
    const dbName = resolveDbName(MONGO_URL, process.env.DB_NAME);
    await mongoose.connect(MONGO_URL, { dbName });
    console.log("MongoDB connected");
  } catch (error) {
    console.error("MongoDB connection failed:");
    console.error(error.message);
    process.exit(1);
  }
}
