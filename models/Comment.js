import mongoose from "mongoose";

const commentSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: true,
    },
    platformCommentId: { type: String, required: true },
    platform: {
      type: String,
      required: true,
      enum: ["Twitter", "Facebook", "Instagram", "LinkedIn"],
    },
    authorName: { type: String, required: true },
    authorId: String,
    content: { type: String, required: true },
    createdAt: { type: Date, required: true },
    engagement: {
      likes: { type: Number, default: 0 },
      replies: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Comment", commentSchema);
