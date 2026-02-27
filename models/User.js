import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    referralCode: {
      type: String,
      unique: true,
      default: function () {
        return `REF_${uuidv4().substring(0, 8).toUpperCase()}`;
      },
    },
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    referralLink: {
      type: String,
      default: function () {
        return `${
          process.env.FRONTEND_URL || "http://localhost:5173"
        }/register?ref=${this.referralCode}`;
      },
    },
    totalReferrals: {
      type: Number,
      default: 0,
    },
    totalCommissionEarned: {
      type: Number,
      default: 0,
    },
    isFirstRechargeCompleted: {
      type: Boolean,
      default: false,
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    isBanned: {
      type: Boolean,
      default: false,
    },
    banReason: {
      type: String,
    },
    banExpiresAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
userSchema.index({ referredBy: 1 });

export default mongoose.model("User", userSchema);
 