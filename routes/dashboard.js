import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import Account from "../models/Account.js";
import Post from "../models/Post.js";
import Message from "../models/Message.js";
import AutoReplyFlow from "../models/AutoReplyFlow.js";
import AutoReplyExecution from "../models/AutoReplyExecution.js";

const router = express.Router();

// Get user dashboard statistics
router.get("/stats", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;

    // Get connected accounts count
    const connectedAccounts = await Account.countDocuments({ userId });

    // Get total posts count
    const totalPosts = await Post.countDocuments({ userId });

    // Get message statistics
    const messageStats = await Message.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: { isRead: "$isRead" },
          count: { $sum: 1 },
        },
      },
    ]);

    const totalMessages = messageStats.reduce(
      (sum, stat) => sum + stat.count,
      0
    );
    const unreadMessages = messageStats
      .filter((stat) => !stat._id.isRead)
      .reduce((sum, stat) => sum + stat.count, 0);

    // Get auto-reply flows count
    const totalFlows = await AutoReplyFlow.countDocuments({ userId });

    // Get auto-reply executions count
    const totalExecutions = await AutoReplyExecution.aggregate([
      {
        $lookup: {
          from: "autoreplyflows",
          localField: "flowId",
          foreignField: "_id",
          as: "flow",
        },
      },
      {
        $match: {
          "flow.userId": userId,
        },
      },
      {
        $count: "total",
      },
    ]);

    const autoRepliesCount =
      totalExecutions.length > 0 ? totalExecutions[0].total : 0;

    // Get recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentPosts = await Post.countDocuments({
      userId,
      createdAt: { $gte: sevenDaysAgo },
    });

    const recentMessages = await Message.countDocuments({
      userId,
      createdAt: { $gte: sevenDaysAgo },
    });

    // Get platform breakdown
    const platformStats = await Account.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: "$platform",
          count: { $sum: 1 },
        },
      },
    ]);

    const platformBreakdown = platformStats.reduce((acc, stat) => {
      acc[stat._id] = stat.count;
      return acc;
    }, {});

    res.json({
      connectedAccounts,
      totalPosts,
      totalMessages,
      unreadMessages,
      totalFlows,
      autoRepliesCount,
      recentActivity: {
        posts: recentPosts,
        messages: recentMessages,
      },
      platformBreakdown,
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    res.status(500).json({ error: "Failed to fetch dashboard statistics" });
  }
});

export default router;

