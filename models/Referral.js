import mongoose from "mongoose";

const referralSchema = new mongoose.Schema(
  {
    referrerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    referredUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    referralCode: {
      type: String,
      required: true,
      unique: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "paid"],
      default: "pending",
    },
    firstRechargeAmount: {
      type: Number,
      default: 0,
    },
    commissionRate: {
      type: Number,
      default: 0.1, // 10% default
      min: 0,
      max: 1,
    },
    commissionAmount: {
      type: Number,
      default: 0,
    },
    paidAt: {
      type: Date,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
referralSchema.index({ referrerId: 1 });
referralSchema.index({ referredUserId: 1 });
referralSchema.index({ referralCode: 1 });
referralSchema.index({ status: 1 });

// Prevent duplicate referrals
referralSchema.index({ referrerId: 1, referredUserId: 1 }, { unique: true });

export default mongoose.model("Referral", referralSchema);
