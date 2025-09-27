import mongoose from "mongoose";

const accountSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
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
  accessToken: { type: String, required: true },
  accessSecret: { type: String },
  refreshToken: { type: String },
  pageId: { type: String },
  platformId: { type: String },
  channelId: { type: String },
  displayName: { type: String },
  expiresAt: { type: Date },
  webhookUrl: { type: String },
  isQuickSetup: { type: Boolean, default: false },
});

export default mongoose.model("Account", accountSchema);
