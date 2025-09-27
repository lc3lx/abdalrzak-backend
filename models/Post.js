import mongoose from "mongoose";

const postSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
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
      ],
    },
    platformPostId: { type: String, required: true },
    content: { type: String, required: true },
    imageUrl: String,
    videoUrl: String,
    description: String,
    privacyStatus: String,
    status: { type: String, default: "published" },
    publishedAt: { type: Date, default: Date.now },
    engagement: {
      likes: { type: Number, default: 0 },
      shares: { type: Number, default: 0 },
      comments: { type: Number, default: 0 },
      retweets: { type: Number, default: 0 },
      lastUpdated: { type: Date, default: Date.now },
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Post", postSchema);
