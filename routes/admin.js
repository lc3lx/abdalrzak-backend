import express from "express";
import { adminAuthMiddleware } from "../middleware/adminAuth.js";
import User from "../models/User.js";
import Wallet from "../models/Wallet.js";
import Referral from "../models/Referral.js";

const router = express.Router();

// Get admin dashboard statistics
router.get("/dashboard/stats", adminAuthMiddleware, async (req, res) => {
  try {
    // Get total users count
    const totalUsers = await User.countDocuments({ role: "user" });
    
    // Get total admins count
    const totalAdmins = await User.countDocuments({ role: "admin" });
    
    // Get banned users count
    const bannedUsers = await User.countDocuments({ isBanned: true });
    
    // Get total wallets and balance
    const wallets = await Wallet.find({});
    const totalWallets = wallets.length;
    const totalBalance = wallets.reduce((sum, wallet) => sum + (wallet.balance || 0), 0);
    
    // Get pending recharge requests
    const pendingRecharges = await Wallet.aggregate([
      { $unwind: "$transactions" },
      { 
        $match: { 
          "transactions.type": "deposit",
          "transactions.status": "pending",
          "transactions.paymentMethod": { $in: ["sham_cash", "payeer", "usdt"] }
        }
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalAmount: { $sum: "$transactions.amount" }
        }
      }
    ]);

    const pendingCount = pendingRecharges.length > 0 ? pendingRecharges[0].count : 0;
    const pendingAmount = pendingRecharges.length > 0 ? pendingRecharges[0].totalAmount : 0;

    // Get recent registrations (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentRegistrations = await User.countDocuments({
      createdAt: { $gte: sevenDaysAgo },
      role: "user"
    });

    // Get total referrals
    const totalReferrals = await Referral.countDocuments();

    // Get active referrals (completed first recharge)
    const activeReferrals = await Referral.countDocuments({ status: "completed" });

    res.json({
      users: {
        total: totalUsers,
        admins: totalAdmins,
        banned: bannedUsers,
        recentRegistrations
      },
      wallets: {
        total: totalWallets,
        totalBalance: totalBalance.toFixed(2)
      },
      rechargeRequests: {
        pending: pendingCount,
        pendingAmount: pendingAmount.toFixed(2)
      },
      referrals: {
        total: totalReferrals,
        active: activeReferrals
      }
    });
  } catch (error) {
    console.error("Error fetching admin dashboard stats:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Get all users with pagination
router.get("/users", adminAuthMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "", role = "", status = "" } = req.query;
    const skip = (page - 1) * limit;

    // Build filter
    const filter = {};
    
    if (search) {
      filter.$or = [
        { username: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } }
      ];
    }
    
    if (role) {
      filter.role = role;
    }
    
    if (status === "banned") {
      filter.isBanned = true;
    } else if (status === "active") {
      filter.isBanned = false;
    }

    const users = await User.find(filter)
      .select("-password")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalUsers = await User.countDocuments(filter);

    // Get wallet info for each user
    const usersWithWallets = await Promise.all(
      users.map(async (user) => {
        const wallet = await Wallet.findOne({ userId: user._id });
        return {
          ...user.toObject(),
          walletBalance: wallet?.balance || 0,
          walletId: wallet?._id
        };
      })
    );

    res.json({
      users: usersWithWallets,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalUsers / limit),
        totalUsers,
        hasNext: page < Math.ceil(totalUsers / limit),
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Get pending recharge requests
router.get("/payments/pending", adminAuthMiddleware, async (req, res) => {
  try {
    const pendingRequests = await Wallet.aggregate([
      { $unwind: "$transactions" },
      { 
        $match: { 
          "transactions.type": "deposit",
          "transactions.status": "pending",
          "transactions.paymentMethod": { $in: ["sham_cash", "payeer", "usdt"] }
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user"
        }
      },
      { $unwind: "$user" },
      {
        $project: {
          transactionId: "$transactions.transactionId",
          amount: "$transactions.amount",
          paymentMethod: "$transactions.paymentMethod",
          description: "$transactions.description",
          createdAt: "$transactions.createdAt",
          userId: "$userId",
          username: "$user.username",
          email: "$user.email",
          walletId: "$_id"
        }
      },
      { $sort: { createdAt: -1 } }
    ]);

    res.json({ pendingRequests });
  } catch (error) {
    console.error("Error fetching pending recharge requests:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Approve recharge request
router.post("/payments/approve/:transactionId", adminAuthMiddleware, async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { amount, notes } = req.body;

    // Find wallet with pending transaction
    const wallet = await Wallet.findOne({
      "transactions.transactionId": transactionId,
      "transactions.status": "pending"
    });

    if (!wallet) {
      return res.status(404).json({ error: "طلب الشحن غير موجود" });
    }

    // Find the specific transaction
    const transaction = wallet.transactions.find(
      t => t.transactionId === transactionId
    );

    if (!transaction) {
      return res.status(404).json({ error: "المعاملة غير موجودة" });
    }

    // Update transaction status
    transaction.status = "completed";
    transaction.notes = notes || "تم الموافقة من الإدارة";
    transaction.completedAt = new Date();

    // Update wallet balance
    wallet.balance = (wallet.balance || 0) + transaction.amount;
    wallet.statistics.totalDeposits += transaction.amount;
    wallet.statistics.transactionCount += 1;
    wallet.statistics.lastTransactionAt = new Date();

    await wallet.save();

    // Check for referral commission
    const user = await User.findById(wallet.userId);
    if (user && !user.isFirstRechargeCompleted) {
      // Process referral commission
      try {
        const referralResponse = await fetch("http://localhost:5000/api/referral/process-commission", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user._id,
            rechargeAmount: transaction.amount
          })
        });
      } catch (referralError) {
        console.error("Error processing referral commission:", referralError);
      }
    }

    res.json({ 
      message: "تم الموافقة على طلب الشحن بنجاح",
      transactionId,
      amount: transaction.amount
    });
  } catch (error) {
    console.error("Error approving recharge request:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Reject recharge request
router.post("/payments/reject/:transactionId", adminAuthMiddleware, async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { reason } = req.body;

    const wallet = await Wallet.findOne({
      "transactions.transactionId": transactionId,
      "transactions.status": "pending"
    });

    if (!wallet) {
      return res.status(404).json({ error: "طلب الشحن غير موجود" });
    }

    const transaction = wallet.transactions.find(
      t => t.transactionId === transactionId
    );

    if (!transaction) {
      return res.status(404).json({ error: "المعاملة غير موجودة" });
    }

    transaction.status = "failed";
    transaction.notes = reason || "تم رفض طلب الشحن من الإدارة";
    transaction.completedAt = new Date();

    await wallet.save();

    res.json({ 
      message: "تم رفض طلب الشحن",
      transactionId
    });
  } catch (error) {
    console.error("Error rejecting recharge request:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Add money to user wallet
router.post("/payments/add-money", adminAuthMiddleware, async (req, res) => {
  try {
    const { userId, amount, reason } = req.body;

    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({ error: "بيانات غير صحيحة" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    let wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      wallet = new Wallet({ userId });
    }

    // Create admin transaction
    const transaction = {
      transactionId: `ADMIN_ADD_${Date.now()}_${userId}`,
      type: "deposit",
      amount: parseFloat(amount),
      description: reason || "إضافة رصيد من الإدارة",
      status: "completed",
      paymentMethod: "admin",
      reference: `ADMIN_${req.adminUser._id}`,
      createdAt: new Date(),
      notes: `تم الإضافة بواسطة: ${req.adminUser.username}`
    };

    wallet.transactions.push(transaction);
    wallet.balance = (wallet.balance || 0) + parseFloat(amount);
    wallet.statistics.totalDeposits += parseFloat(amount);
    wallet.statistics.transactionCount += 1;
    wallet.statistics.lastTransactionAt = new Date();

    await wallet.save();

    res.json({
      message: `تم إضافة $${amount} لحساب ${user.username}`,
      newBalance: wallet.balance
    });
  } catch (error) {
    console.error("Error adding money to user wallet:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Ban user temporarily
router.post("/users/ban/:userId", adminAuthMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason, duration = 24 } = req.body; // duration in hours

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    if (user.role === "admin") {
      return res.status(400).json({ error: "لا يمكن حظر الأدمن" });
    }

    const banExpiresAt = new Date();
    banExpiresAt.setHours(banExpiresAt.getHours() + duration);

    user.isBanned = true;
    user.banReason = reason || "تم الحظر من الإدارة";
    user.banExpiresAt = banExpiresAt;

    await user.save();

    res.json({
      message: `تم حظر المستخدم ${user.username} لمدة ${duration} ساعة`,
      banExpiresAt
    });
  } catch (error) {
    console.error("Error banning user:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Unban user
router.post("/users/unban/:userId", adminAuthMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    user.isBanned = false;
    user.banReason = undefined;
    user.banExpiresAt = undefined;

    await user.save();

    res.json({
      message: `تم إلغاء حظر المستخدم ${user.username}`
    });
  } catch (error) {
    console.error("Error unbanning user:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Delete user
router.delete("/users/:userId", adminAuthMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    if (user.role === "admin") {
      return res.status(400).json({ error: "لا يمكن حذف الأدمن" });
    }

    // Delete user's wallet
    await Wallet.deleteOne({ userId });

    // Delete user's referrals
    await Referral.deleteMany({
      $or: [{ referrerId: userId }, { referredUserId: userId }]
    });

    // Delete user
    await User.findByIdAndDelete(userId);

    res.json({
      message: `تم حذف المستخدم ${user.username} وجميع بياناته`
    });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Promote user to admin
router.post("/users/promote/:userId", adminAuthMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    user.role = "admin";
    await user.save();

    res.json({
      message: `تم ترقية ${user.username} إلى أدمن`
    });
  } catch (error) {
    console.error("Error promoting user:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

export default router;
