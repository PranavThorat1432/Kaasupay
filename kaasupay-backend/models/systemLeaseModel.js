import mongoose from "mongoose";

const systemLeaseSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // e.g. "autopay_processor"
    ownerId: { type: String, default: null },
    fencingToken: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true, default: () => new Date(0) },
    acquiredAt: { type: Date, required: true, default: () => new Date(0) },
    lastHeartbeat: { type: Date, required: true, default: () => new Date(0) },
    metadata: {
      hostname: { type: String, default: null },
      pid: { type: Number, default: null },
      instanceUuid: { type: String, default: null },
    },
  },
  {
    collection: "system_leases",
    timestamps: true,
  }
);

// TTL index is strictly for asynchronous housekeeping (disk space reclamation)
// It does NOT determine or grant active ownership.
systemLeaseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const SystemLease = mongoose.models.SystemLease || mongoose.model("SystemLease", systemLeaseSchema);

export default SystemLease;
