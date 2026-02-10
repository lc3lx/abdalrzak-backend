import express from "express";
import Comment from "../../models/Comment.js";
import Post from "../../models/Post.js";
import Account from "../../models/Account.js";
import Message from "../../models/Message.js";
import { TwitterApi } from "twitter-api-v2";
import FB from "fb";
import axios from "axios";
import { authMiddleware } from "../../middleware/auth.js";

const router = express.Router();

// Get comments for a post
router.get("/posts/:postId/comments", authMiddleware, async (req, res) => {
  try {
    const { postId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    // Verify post belongs to user
    const post = await Post.findOne({ _id: postId, userId: req.userId });
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    const comments = await Comment.find({ postId })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Comment.countDocuments({ postId });

    res.json({
      comments,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

// Reply to a comment
router.post("/comments/:commentId/reply", authMiddleware, async (req, res) => {
  try {
    const { commentId } = req.params;
    const { content, imageUrl } = req.body;

    if (!content) {
      return res.status(400).json({ error: "Reply content is required" });
    }

    // Get the comment
    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ error: "Comment not found" });
    }

    // Verify post belongs to user
    const post = await Post.findOne({ _id: comment.postId, userId: req.userId });
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    // Get the account for the platform
    const account = await Account.findOne({
      userId: req.userId,
      platform: comment.platform,
    });

    if (!account) {
      return res.status(404).json({ error: "Account not found for this platform" });
    }

    let replyResult = {};

    // Send reply based on platform
    if (comment.platform === "Twitter") {
      replyResult = await replyToTwitterComment(account, comment, content);
    } else if (comment.platform === "Facebook") {
      replyResult = await replyToFacebookComment(account, comment, content);
    } else if (comment.platform === "Instagram") {
      replyResult = await replyToInstagramComment(account, comment, content);
    } else {
      return res.status(400).json({ error: "Reply not supported for this platform" });
    }

    if (replyResult.success) {
      // Save the reply as a new comment
      const replyComment = new Comment({
        postId: comment.postId,
        platformCommentId: replyResult.commentId,
        platform: comment.platform,
        authorName: account.displayName || "You",
        authorId: account.platformId,
        content: content,
        createdAt: new Date(),
        parentCommentId: comment._id,
      });

      await replyComment.save();

      // Also save as message for auto-reply processing
      const message = new Message({
        userId: req.userId,
        platform: comment.platform,
        platformMessageId: replyResult.commentId,
        senderId: account.platformId,
        senderName: account.displayName,
        content: content,
        messageType: "comment",
        receivedAt: new Date(),
        replyToMessageId: comment.platformCommentId,
      });

      await message.save();

      // Trigger auto-reply if needed
      const baseUrl = process.env.BASE_URL || "https://www.sushiluha.com";
      try {
        await axios.post(
          `${baseUrl}/api/auto-reply/process`,
          { messageId: message._id },
          {
            headers: {
              Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN || "internal"}`,
            },
          }
        );
      } catch (error) {
        console.error("Error triggering auto-reply:", error);
      }

      res.json({
        success: true,
        comment: replyComment,
        message: "Reply sent successfully",
      });
    } else {
      res.status(500).json({
        error: "Failed to send reply",
        details: replyResult.error,
      });
    }
  } catch (error) {
    console.error("Error replying to comment:", error);
    res.status(500).json({ error: "Failed to reply to comment" });
  }
});

// Reply to Twitter comment
async function replyToTwitterComment(account, comment, content) {
  try {
    const twitterClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: account.accessToken,
      accessSecret: account.accessSecret,
    }).readWrite;

    // Get the post to find the tweet ID
    const post = await Post.findById(comment.postId);
    if (!post) {
      throw new Error("Post not found");
    }

    const response = await twitterClient.v2.reply(content, post.platformPostId, {
      in_reply_to_user_id: comment.authorId,
    });

    return {
      success: true,
      commentId: response.data.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// Reply to Facebook comment
async function replyToFacebookComment(account, comment, content) {
  try {
    FB.setAccessToken(account.accessToken);

    const response = await new Promise((resolve, reject) => {
      FB.api(
        `/${comment.platformCommentId}/comments`,
        "POST",
        { message: content },
        (res) => (res.error ? reject(res.error) : resolve(res))
      );
    });

    return {
      success: true,
      commentId: response.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// Reply to Instagram comment
async function replyToInstagramComment(account, comment, content) {
  try {
    // Instagram Graph API for replying to comments
    const response = await axios.post(
      `https://graph.instagram.com/${comment.platformCommentId}/replies`,
      {
        message: content,
      },
      {
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
        },
      }
    );

    return {
      success: true,
      commentId: response.data.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message,
    };
  }
}

export default router;
