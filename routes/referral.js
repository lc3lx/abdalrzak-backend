import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import User from "../models/User.js";
import Referral from "../models/Referral.js";
import Wallet from "../models/Wallet.js";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Get user's referral information
router.get("/my-referrals", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;

    // Get user's referral stats
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    // Get all referrals made by this user
    const referrals = await Referral.find({ referrerId: userId })
      .populate("referredUserId", "username email createdAt")
      .sort({ createdAt: -1 });

    // Get pending, completed, and paid referrals count
    const stats = {
      total: referrals.length,
      pending: referrals.filter((r) => r.status === "pending").length,
      completed: referrals.filter((r) => r.status === "completed").length,
      paid: referrals.filter((r) => r.status === "paid").length,
      totalCommissionEarned: user.totalCommissionEarned,
    };

    res.json({
      referralCode: user.referralCode,
      referralLink: user.referralLink,
      stats,
      referrals,
    });
  } catch (error) {
    console.error("Error fetching referral data:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Get referral settings (admin only)
router.get("/settings", authMiddleware, async (req, res) => {
  try {
    // TODO: Add admin check
    const settings = {
      defaultCommissionRate: 0.1, // 10%
      minRechargeAmount: 10, // Minimum recharge to qualify
      maxCommissionRate: 0.5, // 50% max
    };

    res.json(settings);
  } catch (error) {
    console.error("Error fetching referral settings:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Update referral settings (admin only)
router.put("/settings", authMiddleware, async (req, res) => {
  try {
    // TODO: Add admin check
    const { commissionRate, minRechargeAmount } = req.body;

    // Validate commission rate
    if (commissionRate < 0 || commissionRate > 0.5) {
      return res
        .status(400)
        .json({ error: "نسبة العمولة يجب أن تكون بين 0% و 50%" });
    }

    // TODO: Save settings to database or config file

    res.json({
      message: "تم تحديث إعدادات الإحالة بنجاح",
      settings: { commissionRate, minRechargeAmount },
    });
  } catch (error) {
    console.error("Error updating referral settings:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Process referral when user registers
router.post("/process-registration", async (req, res) => {
  try {
    const { userId, referralCode } = req.body;

    if (!referralCode) {
      return res.json({ message: "No referral code provided" });
    }

    // Find the referrer
    const referrer = await User.findOne({ referralCode });
    if (!referrer) {
      return res.status(400).json({ error: "رمز الإحالة غير صحيح" });
    }

    // Check if user is trying to refer themselves
    if (referrer._id.toString() === userId) {
      return res.status(400).json({ error: "لا يمكنك الإحالة لنفسك" });
    }

    // Update the new user's referredBy field
    await User.findByIdAndUpdate(userId, { referredBy: referrer._id });

    // Create referral record
    const referral = new Referral({
      referrerId: referrer._id,
      referredUserId: userId,
      referralCode,
      status: "pending",
    });

    await referral.save();

    // Update referrer's total referrals count
    await User.findByIdAndUpdate(referrer._id, {
      $inc: { totalReferrals: 1 },
    });

    res.json({
      message: "تم ربط الإحالة بنجاح",
      referrerName: referrer.username,
    });
  } catch (error) {
    console.error("Error processing referral registration:", error);
    res.status(500).json({ error: "خطأ في معالجة الإحالة" });
  }
});

// Process referral commission when user makes first recharge
router.post("/process-commission", async (req, res) => {
  try {
    const { userId, rechargeAmount } = req.body;

    // Find the user and their referrer
    const user = await User.findById(userId).populate("referredBy");
    if (!user || !user.referredBy || user.isFirstRechargeCompleted) {
      return res.json({ message: "No commission to process" });
    }

    // Find the referral record
    const referral = await Referral.findOne({
      referrerId: user.referredBy._id,
      referredUserId: userId,
      status: "pending",
    });

    if (!referral) {
      return res.json({ message: "No pending referral found" });
    }

    // Calculate commission (10% default, can be configured by admin)
    const commissionRate = 0.1; // TODO: Get from admin settings
    const commissionAmount = rechargeAmount * commissionRate;

    // Update referral record
    referral.status = "completed";
    referral.firstRechargeAmount = rechargeAmount;
    referral.commissionRate = commissionRate;
    referral.commissionAmount = commissionAmount;
    await referral.save();

    // Update user's first recharge status
    await User.findByIdAndUpdate(userId, {
      isFirstRechargeCompleted: true,
    });

    // Add commission to referrer's wallet
    const referrerWallet = await Wallet.findOne({
      userId: user.referredBy._id,
    });
    if (referrerWallet) {
      // Add commission transaction
      const commissionTransaction = {
        transactionId: `COMMISSION_${Date.now()}_${user.referredBy._id}`,
        type: "bonus",
        amount: commissionAmount,
        description: `عمولة إحالة - ${user.username}`,
        status: "completed",
        paymentMethod: "referral",
        reference: `REF_${referral._id}`,
        createdAt: new Date(),
      };

      referrerWallet.transactions.push(commissionTransaction);
      referrerWallet.balance = (referrerWallet.balance || 0) + commissionAmount;
      referrerWallet.statistics.totalDeposits += commissionAmount;
      referrerWallet.statistics.transactionCount += 1;
      referrerWallet.statistics.lastTransactionAt = new Date();

      await referrerWallet.save();
    }

    // Update referrer's total commission earned
    await User.findByIdAndUpdate(user.referredBy._id, {
      $inc: { totalCommissionEarned: commissionAmount },
    });

    res.json({
      message: "تم معالجة عمولة الإحالة بنجاح",
      commissionAmount,
      referrerName: user.referredBy.username,
    });
  } catch (error) {
    console.error("Error processing referral commission:", error);
    res.status(500).json({ error: "خطأ في معالجة عمولة الإحالة" });
  }
});

// Get referral leaderboard (optional)
router.get("/leaderboard", async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const topReferrers = await User.find({ totalReferrals: { $gt: 0 } })
      .select("username totalReferrals totalCommissionEarned")
      .sort({ totalReferrals: -1 })
      .limit(parseInt(limit));

    res.json({ leaderboard: topReferrers });
  } catch (error) {
    console.error("Error fetching referral leaderboard:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

export default router;
