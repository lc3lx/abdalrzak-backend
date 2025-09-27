import mongoose from "mongoose";

const autoReplyFlowSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    description: String,
    platform: {
      type: String,
      required: true,
      enum: [
        "Twitter",
        "Facebook",
        "Instagram",
        "LinkedIn",
        "Telegram",
        "WhatsApp",
        "TikTok",
        "YouTube",
        "All",
      ],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    triggerKeywords: [String], // Keywords that trigger this flow
    triggerConditions: {
      type: {
        type: String,
        enum: ["keyword", "time", "sender", "message_type"],
        default: "keyword",
      },
      value: String, // The actual condition value
    },
    flowSteps: [
      {
        stepNumber: {
          type: Number,
          required: true,
        },
        stepType: {
          type: String,
          enum: [
            "immediate_reply",
            "delayed_reply",
            "conditional_reply",
            "end",
          ],
          required: true,
        },
        delay: {
          type: Number, // Delay in minutes
          default: 0,
        },
        condition: {
          type: String, // Condition for conditional replies
          enum: ["contains_keyword", "time_based", "sender_based", "always"],
          default: "always",
        },
        conditionValue: String, // Value for the condition
        replyContent: {
          type: String,
          required: true,
        },
        replyImage: String, // URL of image to attach
        nextStep: Number, // Next step number
        isEndStep: {
          type: Boolean,
          default: false,
        },
      },
    ],
    settings: {
      maxRepliesPerUser: {
        type: Number,
        default: 3,
      },
      cooldownPeriod: {
        type: Number, // Hours
        default: 24,
      },
      workingHours: {
        enabled: Boolean,
        startTime: String, // "09:00"
        endTime: String, // "17:00"
        timezone: String, // "UTC"
      },
    },
    statistics: {
      totalTriggers: {
        type: Number,
        default: 0,
      },
      totalReplies: {
        type: Number,
        default: 0,
      },
      lastTriggered: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
autoReplyFlowSchema.index({ userId: 1, platform: 1, isActive: 1 });
autoReplyFlowSchema.index({ triggerKeywords: 1 });

export default mongoose.model("AutoReplyFlow", autoReplyFlowSchema);
