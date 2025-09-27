import mongoose from "mongoose";

const autoReplyExecutionSchema = new mongoose.Schema(
  {
    flowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AutoReplyFlow",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    originalMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      required: true,
    },
    platform: {
      type: String,
      required: true,
    },
    senderId: String,
    senderName: String,
    currentStep: {
      type: Number,
      default: 1,
    },
    status: {
      type: String,
      enum: ["active", "completed", "paused", "failed"],
      default: "active",
    },
    executedSteps: [
      {
        stepNumber: Number,
        executedAt: Date,
        replyContent: String,
        replyMessageId: String, // Platform message ID
        success: Boolean,
        error: String,
      },
    ],
    nextExecutionTime: Date,
    totalReplies: {
      type: Number,
      default: 0,
    },
    lastActivity: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
autoReplyExecutionSchema.index({ flowId: 1, status: 1 });
autoReplyExecutionSchema.index({ userId: 1, platform: 1 });
autoReplyExecutionSchema.index({ nextExecutionTime: 1 });

export default mongoose.model("AutoReplyExecution", autoReplyExecutionSchema);
