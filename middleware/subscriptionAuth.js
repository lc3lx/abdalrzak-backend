import Subscription from "../models/Subscription.js";

export const requireSubscription = (serviceType) => {
  return async (req, res, next) => {
    try {
      const userId = req.userId;

      if (!userId) {
        return res.status(401).json({ error: "غير مصرح" });
      }

      // Check if user has active subscription with access to the service
      const hasAccess = await Subscription.hasServiceAccess(
        userId,
        serviceType
      );

      if (!hasAccess) {
        return res.status(403).json({
          error: "يجب الاشتراك في باقة تحتوي على هذه الخدمة",
          requiredService: serviceType,
          code: "SUBSCRIPTION_REQUIRED",
        });
      }

      next();
    } catch (error) {
      console.error("Subscription auth middleware error:", error);
      res.status(500).json({ error: "خطأ في الخادم" });
    }
  };
};

export const checkSubscription = async (req, res, next) => {
  try {
    const userId = req.userId;

    if (userId) {
      const activeSubscription = await Subscription.getActiveSubscription(
        userId
      );
      req.userSubscription = activeSubscription;
    }

    next();
  } catch (error) {
    console.error("Subscription check middleware error:", error);
    // Continue without subscription info if there's an error
    next();
  }
};






