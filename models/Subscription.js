import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    packageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Package",
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "expired", "cancelled", "pending"],
      default: "pending",
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    autoRenew: {
      type: Boolean,
      default: true,
    },
    paymentTransactionId: {
      type: String,
    },
    amountPaid: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "USD",
    },
    paymentMethod: {
      type: String,
      enum: ["wallet", "admin", "refund"],
      required: true,
    },
    notes: {
      type: String,
    },
    cancelledAt: {
      type: Date,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    cancelledReason: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
subscriptionSchema.index({ userId: 1, status: 1 });
subscriptionSchema.index({ endDate: 1, status: 1 });
subscriptionSchema.index({ packageId: 1 });

// Method to check if subscription is active
subscriptionSchema.methods.isActive = function () {
  const now = new Date();
  return (
    this.status === "active" && this.startDate <= now && this.endDate >= now
  );
};

// Method to get remaining days
subscriptionSchema.methods.getRemainingDays = function () {
  const now = new Date();
  if (this.status !== "active" || this.endDate < now) {
    return 0;
  }
  const diffTime = this.endDate - now;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// Static method to get user's active subscription
subscriptionSchema.statics.getActiveSubscription = async function (userId) {
  const now = new Date();
  return this.findOne({
    userId,
    status: "active",
    startDate: { $lte: now },
    endDate: { $gte: now },
  }).populate("packageId");
};

// Static method to check if user has access to a service
subscriptionSchema.statics.hasServiceAccess = async function (
  userId,
  serviceType
) {
  const subscription = await this.getActiveSubscription(userId);
  if (!subscription) {
    return false;
  }

  const packageServices = subscription.packageId.services;
  return packageServices.some(
    (service) => service.type === serviceType || service.type === "all_services"
  );
};

export default mongoose.model("Subscription", subscriptionSchema);








