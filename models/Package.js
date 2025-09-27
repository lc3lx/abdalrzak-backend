import mongoose from "mongoose";

const packageSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    nameAr: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    descriptionAr: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "USD",
    },
    duration: {
      type: Number,
      required: true,
      default: 30, // days
    },
    features: [
      {
        name: {
          type: String,
          required: true,
        },
        nameAr: {
          type: String,
          required: true,
        },
        description: {
          type: String,
        },
        descriptionAr: {
          type: String,
        },
        included: {
          type: Boolean,
          default: true,
        },
      },
    ],
    services: [
      {
        type: {
          type: String,
          enum: [
            "facebook",
            "instagram",
            "twitter",
            "linkedin",
            "tiktok",
            "youtube",
            "auto_reply",
            "analytics",
            "scheduling",
            "all_services",
          ],
          required: true,
        },
        name: {
          type: String,
          required: true,
        },
        nameAr: {
          type: String,
          required: true,
        },
        enabled: {
          type: Boolean,
          default: true,
        },
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    isPopular: {
      type: Boolean,
      default: false,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    maxAccounts: {
      type: Number,
      default: 1,
    },
    maxPostsPerDay: {
      type: Number,
      default: 10,
    },
    maxAutoReplies: {
      type: Number,
      default: 100,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "premium"],
      default: "medium",
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
packageSchema.index({ isActive: 1, sortOrder: 1 });
packageSchema.index({ "services.type": 1 });

export default mongoose.model("Package", packageSchema);
