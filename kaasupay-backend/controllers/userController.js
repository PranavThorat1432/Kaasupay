import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import Wallet from "../models/walletModel.js";
import { JWT_SECRET } from "../config.js";
import { setOrUpdatePin } from "../services/pinService.js";

// Profile update rules (PUT /api/v1/user). Everything is optional, but at
// least one field must be provided. .strict() rejects unknown fields, so a
// client cannot try to overwrite "username" or anything else not listed.
const updateProfileSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(1, { error: "First name cannot be empty" })
      .max(50, { error: "First name cannot exceed 50 characters" })
      .optional(),
    lastName: z
      .string()
      .trim()
      .min(1, { error: "Last name cannot be empty" })
      .max(50, { error: "Last name cannot exceed 50 characters" })
      .optional(),
    password: z
      .string()
      .min(6, { error: "Password must be at least 6 characters" })
      .optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.firstName !== undefined ||
      data.lastName !== undefined ||
      data.password !== undefined,
    { error: "Provide at least one field to update" }
  );

// Signup input rules.
const signupSchema = z.object({
  username: z
    .string({ error: "Username is required" })
    .trim()
    .toLowerCase()
    .email({ error: "Username must be a valid email" }),
  firstName: z
    .string({ error: "First name is required" })
    .trim()
    .min(1, { error: "First name cannot be empty" })
    .max(50, { error: "First name cannot exceed 50 characters" }),
  lastName: z
    .string({ error: "Last name is required" })
    .trim()
    .min(1, { error: "Last name cannot be empty" })
    .max(50, { error: "Last name cannot exceed 50 characters" }),
  password: z
    .string({ error: "Password is required" })
    .min(6, { error: "Password must be at least 6 characters" }),
});

// Signin input rules.
const signinSchema = z.object({
  username: z
    .string({ error: "Username is required" })
    .trim()
    .toLowerCase()
    .email({ error: "Username must be a valid email" }),
  password: z.string({ error: "Password is required" }),
});

const signup = async (req, res) => {
  try {
    const body = req.body;
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input" });
    }

    const { firstName, lastName, password } = parsed.data;
    const username = parsed.data.username;

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(409).json({
        error: "This email is already registered",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    let user;
    try {
      user = await User.create({
        username,
        firstName,
        lastName,
        passwordHash,
        tokenVersion: 0,
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({
          error: "This email is already registered",
        });
      }
      throw error;
    }

    const wallet = await Wallet.create({
      userId: user._id,
      balance: 0,
    });

    return res.status(201).json({
      message: "User created successfully",
      user: {
        _id: user._id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      wallet: {
        _id: wallet._id,
        balance: wallet.balance,
      },
    });
  } catch (error) {
    console.error("Unexpected error in signup:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const signin = async (req, res) => {
  try {
    const body = req.body;
    const parsed = signinSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input" });
    }

    const { password } = parsed.data;
    const username = parsed.data.username;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: "Wrong email or password" });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Wrong email or password" });
    }

    // Embed tokenVersion (tv) in JWT
    const token = jwt.sign(
      { userId: user._id.toString(), tv: user.tokenVersion || 0 },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    return res.status(200).json({
      message: "Signed in",
      token,
    });
  } catch (error) {
    console.error("Unexpected error in signin:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const getMe = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.userId)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const hasPin = Boolean(user.pinHash);

    return res.status(200).json({
      user: {
        _id: user._id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        hasPin,
      },
      hasPin,
    });
  } catch (error) {
    console.error("Unexpected error in getMe:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const updateProfile = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.userId)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input" });
    }

    const { firstName, lastName, password } = parsed.data;
    const updates = {};
    if (firstName !== undefined) updates.firstName = firstName;
    if (lastName !== undefined) updates.lastName = lastName;

    if (password !== undefined) {
      updates.passwordHash = await bcrypt.hash(password, 10);
      const user = await User.findByIdAndUpdate(
        req.userId,
        { ...updates, $inc: { tokenVersion: 1 } },
        { returnDocument: "after" }
      );

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Generate a fresh token with updated tokenVersion for current session
      const token = jwt.sign(
        { userId: user._id.toString(), tv: user.tokenVersion },
        JWT_SECRET,
        { expiresIn: "1h" }
      );

      return res.status(200).json({
        message: "Password changed. You are signed out on all devices",
        token,
        user: {
          _id: user._id,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      });
    }

    const user = await User.findByIdAndUpdate(req.userId, updates, {
      returnDocument: "after",
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({
      message: "Profile updated",
      user: {
        _id: user._id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (error) {
    console.error("Unexpected error in updateProfile:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const bulkSearch = async (req, res) => {
  try {
    const filter = typeof req.query.filter === "string" ? req.query.filter.trim() : "";
    if (!filter) {
      return res.status(400).json({ error: "Invalid input" });
    }

    const escaped = filter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "i");

    const users = await User.find({
      $or: [{ firstName: pattern }, { lastName: pattern }],
    })
      .select("firstName lastName username")
      .limit(50);

    return res.status(200).json({ users });
  } catch (error) {
    console.error("Unexpected error in bulkSearch:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const setPin = async (req, res) => {
  try {
    const { password, pin } = req.body || {};
    if (!password || typeof password !== "string") {
      return res.status(401).json({ message: "Wrong password" });
    }
    const result = await setOrUpdatePin(req.userId, password, pin);
    return res.status(200).json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ message: error.message });
  }
};

const logoutAll = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.userId, { $inc: { tokenVersion: 1 } });
    return res.status(200).json({ message: "Signed out on all devices" });
  } catch (error) {
    console.error("Unexpected error in logoutAll:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

export {
  signup,
  signin,
  getMe,
  updateProfile,
  bulkSearch,
  setPin,
  logoutAll,
};
