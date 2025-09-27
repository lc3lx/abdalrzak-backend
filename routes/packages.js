import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import { adminAuthMiddleware } from "../middleware/adminAuth.js";
import { checkSubscription } from "../middleware/subscriptionAuth.js";
import Package from "../models/Package.js";
import Subscription from "../models/Subscription.js";
import Wallet from "../models/Wallet.js";
import User from "../models/User.js";

const router = express.Router();

// Get all active packages for users
router.get("/", checkSubscription, async (req, res) => {
  try {
    const packages = await Package.find({ isActive: true }).sort({
      sortOrder: 1,
      price: 1,
    });

    // Add subscription info for current user
    const packagesWithSubscription = packages.map((pkg) => ({
      ...pkg.toObject(),
      userSubscription:
        req.userSubscription?.packageId?.toString() === pkg._id.toString()
          ? {
              status: req.userSubscription.status,
              endDate: req.userSubscription.endDate,
              remainingDays: req.userSubscription.getRemainingDays(),
            }
          : null,
    }));

    res.json({ packages: packagesWithSubscription });
  } catch (error) {
    console.error("Error fetching packages:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Get user's current subscription
router.get("/my-subscription", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;

    const activeSubscription = await Subscription.getActiveSubscription(userId);

    if (!activeSubscription) {
      return res.json({
        subscription: null,
        message: "لا يوجد اشتراك نشط",
      });
    }

    res.json({
      subscription: {
        ...activeSubscription.toObject(),
        remainingDays: activeSubscription.getRemainingDays(),
        isActive: activeSubscription.isActive(),
      },
    });
  } catch (error) {
    console.error("Error fetching user subscription:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Purchase a package
router.post("/purchase", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const { packageId } = req.body;

    // Validate package exists and is active
    const packageData = await Package.findById(packageId);
    if (!packageData || !packageData.isActive) {
      return res.status(404).json({ error: "الباقة غير موجودة أو غير متاحة" });
    }

    // Check if user has sufficient balance
    const wallet = await Wallet.findOne({ userId });
    if (!wallet || wallet.balance < packageData.price) {
      return res.status(400).json({
        error: "الرصيد غير كافي",
        required: packageData.price,
        available: wallet?.balance || 0,
      });
    }

    // Check if user already has an active subscription
    const existingSubscription = await Subscription.getActiveSubscription(
      userId
    );
    if (existingSubscription) {
      return res.status(400).json({
        error: "لديك اشتراك نشط بالفعل",
        currentSubscription: {
          packageName: existingSubscription.packageId.nameAr,
          endDate: existingSubscription.endDate,
          remainingDays: existingSubscription.getRemainingDays(),
        },
      });
    }

    // Calculate subscription dates
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + packageData.duration);

    // Create subscription
    const subscription = new Subscription({
      userId,
      packageId,
      status: "active",
      startDate: now,
      endDate,
      amountPaid: packageData.price,
      paymentMethod: "wallet",
      paymentTransactionId: `PACKAGE_${Date.now()}_${userId}`,
    });

    // Deduct amount from wallet
    const transaction = {
      transactionId: `PACKAGE_${Date.now()}_${userId}`,
      type: "payment",
      amount: packageData.price,
      description: `اشتراك في باقة ${packageData.nameAr}`,
      status: "completed",
      paymentMethod: "package",
      reference: `PACKAGE_${packageId}`,
      createdAt: new Date(),
    };

    wallet.transactions.push(transaction);
    wallet.balance -= packageData.price;
    wallet.statistics.totalSpent += packageData.price;
    wallet.statistics.transactionCount += 1;
    wallet.statistics.lastTransactionAt = new Date();

    // Save both subscription and wallet
    await Promise.all([subscription.save(), wallet.save()]);

    res.json({
      message: `تم الاشتراك في باقة ${packageData.nameAr} بنجاح`,
      subscription: {
        ...subscription.toObject(),
        package: packageData,
        remainingDays: subscription.getRemainingDays(),
      },
      newWalletBalance: wallet.balance,
    });
  } catch (error) {
    console.error("Error purchasing package:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Cancel subscription
router.post("/cancel-subscription", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const { reason } = req.body;

    const activeSubscription = await Subscription.getActiveSubscription(userId);
    if (!activeSubscription) {
      return res.status(404).json({ error: "لا يوجد اشتراك نشط" });
    }

    activeSubscription.status = "cancelled";
    activeSubscription.cancelledAt = new Date();
    activeSubscription.cancelledBy = userId;
    activeSubscription.cancelledReason = reason || "تم الإلغاء من قبل المستخدم";

    await activeSubscription.save();

    res.json({
      message: "تم إلغاء الاشتراك بنجاح",
      subscription: {
        ...activeSubscription.toObject(),
        package: activeSubscription.packageId,
      },
    });
  } catch (error) {
    console.error("Error cancelling subscription:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Admin routes
// Get all packages for admin
router.get("/admin/all", adminAuthMiddleware, async (req, res) => {
  try {
    const packages = await Package.find({}).sort({
      sortOrder: 1,
      createdAt: -1,
    });

    res.json({ packages });
  } catch (error) {
    console.error("Error fetching all packages:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Create new package
router.post("/admin/create", adminAuthMiddleware, async (req, res) => {
  try {
    const packageData = req.body;

    const newPackage = new Package(packageData);
    await newPackage.save();

    res.json({
      message: "تم إنشاء الباقة بنجاح",
      package: newPackage,
    });
  } catch (error) {
    console.error("Error creating package:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Update package
router.put("/admin/:packageId", adminAuthMiddleware, async (req, res) => {
  try {
    const { packageId } = req.params;
    const updateData = req.body;

    const updatedPackage = await Package.findByIdAndUpdate(
      packageId,
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedPackage) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }

    res.json({
      message: "تم تحديث الباقة بنجاح",
      package: updatedPackage,
    });
  } catch (error) {
    console.error("Error updating package:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Delete package
router.delete("/admin/:packageId", adminAuthMiddleware, async (req, res) => {
  try {
    const { packageId } = req.params;

    const deletedPackage = await Package.findByIdAndDelete(packageId);
    if (!deletedPackage) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }

    res.json({
      message: "تم حذف الباقة بنجاح",
    });
  } catch (error) {
    console.error("Error deleting package:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// Get all subscriptions for admin
router.get("/admin/subscriptions", adminAuthMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 10, status = "" } = req.query;
    const skip = (page - 1) * limit;

    const filter = {};
    if (status) {
      filter.status = status;
    }

    const subscriptions = await Subscription.find(filter)
      .populate("userId", "username email")
      .populate("packageId", "name nameAr price")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalSubscriptions = await Subscription.countDocuments(filter);

    res.json({
      subscriptions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalSubscriptions / limit),
        totalSubscriptions,
        hasNext: page < Math.ceil(totalSubscriptions / limit),
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching subscriptions:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

export default router;




