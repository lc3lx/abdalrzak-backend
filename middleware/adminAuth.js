import { authMiddleware } from "./auth.js";
import User from "../models/User.js";

export const adminAuthMiddleware = async (req, res, next) => {
  try {
    // First check if user is authenticated
    await new Promise((resolve, reject) => {
      authMiddleware(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Check if user exists and has admin role
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    if (user.role !== "admin") {
      return res.status(403).json({ error: "ليس لديك صلاحية للوصول لهذه الصفحة" });
    }

    // Check if user is banned
    if (user.isBanned) {
      if (user.banExpiresAt && user.banExpiresAt > new Date()) {
        return res.status(403).json({ 
          error: "تم حظر حسابك مؤقتاً",
          banReason: user.banReason,
          banExpiresAt: user.banExpiresAt
        });
      } else {
        // Ban expired, unban user
        user.isBanned = false;
        user.banReason = undefined;
        user.banExpiresAt = undefined;
        await user.save();
      }
    }

    req.adminUser = user;
    next();
  } catch (error) {
    console.error("Admin auth middleware error:", error);
    res.status(401).json({ error: "غير مصرح" });
  }
};
