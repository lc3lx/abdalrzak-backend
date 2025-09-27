import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    platform: {
      type: String,
      required: true,
      enum: ["Twitter", "Facebook", "Instagram", "LinkedIn"],
    },
    platformMessageId: {
      type: String,
      required: true,
    },
    senderId: {
      type: String,
      required: true,
    },
    senderName: {
      type: String,
      required: true,
    },
    senderUsername: String,
    content: {
      type: String,
      required: true,
    },
    messageType: {
      type: String,
      enum: ["direct_message", "mention", "comment", "reply"],
      default: "direct_message",
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
    receivedAt: {
      type: Date,
      required: true,
    },
    attachments: [
      {
        type: String, // URL of attachment
        mediaType: String, // image, video, document
      },
    ],
    replyToMessageId: String, // For replies
    threadId: String, // For grouping related messages
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
messageSchema.index({ userId: 1, platform: 1, receivedAt: -1 });
messageSchema.index({ userId: 1, isRead: 1 });
messageSchema.index({ platformMessageId: 1 }, { unique: true });

export default mongoose.model("Message", messageSchema);
