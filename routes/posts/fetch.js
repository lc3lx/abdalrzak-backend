import express from "express";
import axios from "axios";
import { TwitterApi } from "twitter-api-v2";
import Account from "../../models/Account.js";
import Post from "../../models/Post.js";
import Comment from "../../models/Comment.js";
import { authMiddleware } from "../../middleware/auth.js";

const router = express.Router();

// Fetch all published posts with their interactions
router.get("/posts/published", authMiddleware, async (req, res) => {
  try {
    const posts = await Post.find({ userId: req.userId })
      .sort({ publishedAt: -1 })
      .populate("userId", "username email");

    const postsWithComments = await Promise.all(
      posts.map(async (post) => {
        const comments = await Comment.find({ postId: post._id })
          .sort({ createdAt: -1 })
          .limit(10); // Limit to 10 most recent comments

        const po = post.toObject();
        po.engagement = {
          likes: po.engagement?.likes ?? 0,
          comments: po.engagement?.comments ?? 0,
          shares: po.engagement?.shares ?? 0,
          retweets: po.engagement?.retweets ?? 0,
          lastUpdated: po.engagement?.lastUpdated || po.publishedAt || new Date(),
        };
        return {
          ...po,
          comments,
        };
      })
    );

    res.json(postsWithComments);
  } catch (error) {
    console.error("Error fetching published posts:", error);
    res.status(500).json({ error: "Failed to fetch published posts" });
  }
});

// Fetch posts and update engagement data from social media platforms
router.post("/posts/sync-engagement", authMiddleware, async (req, res) => {
  try {
    const accounts = await Account.find({ userId: req.userId });
    const results = {};

    for (const account of accounts) {
      const platformPosts = await Post.find({
        userId: req.userId,
        platform: account.platform,
      });

      if (account.platform === "Twitter") {
        results.Twitter = await syncTwitterEngagement(account, platformPosts);
      } else if (account.platform === "Facebook") {
        results.Facebook = await syncFacebookEngagement(account, platformPosts);
      } else if (account.platform === "LinkedIn") {
        results.LinkedIn = await syncLinkedInEngagement(account, platformPosts);
      }
    }

    res.json(results);
  } catch (error) {
    console.error("Error syncing engagement:", error);
    res.status(500).json({ error: "Failed to sync engagement data" });
  }
});

// Sync Twitter engagement data
async function syncTwitterEngagement(account, posts) {
  try {
    const twitterClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: account.accessToken,
      accessSecret: account.accessSecret,
    }).readOnly;

    const results = [];

    for (const post of posts) {
      try {
        const tweetData = await twitterClient.v2.singleTweet(
          post.platformPostId,
          {
            "tweet.fields": ["public_metrics", "created_at"],
            expansions: ["author_id"],
          }
        );

        const metrics = tweetData.data.public_metrics;

        // Update post engagement
        await Post.findByIdAndUpdate(post._id, {
          "engagement.likes": metrics.like_count || 0,
          "engagement.retweets": metrics.retweet_count || 0,
          "engagement.comments": metrics.reply_count || 0,
          "engagement.shares": 0, // Twitter doesn't have shares
          "engagement.lastUpdated": new Date(),
        });

        // Fetch comments (replies)
        const replies = await twitterClient.v2.search({
          query: `conversation_id:${post.platformPostId}`,
          "tweet.fields": ["created_at", "author_id", "public_metrics"],
          "user.fields": ["username", "name"],
          max_results: 10,
        });

        // Save comments
        for (const reply of replies.data?.data || []) {
          await Comment.findOneAndUpdate(
            { platformCommentId: reply.id },
            {
              postId: post._id,
              platformCommentId: reply.id,
              platform: "Twitter",
              authorName: reply.author_id,
              content: reply.text,
              createdAt: new Date(reply.created_at),
              "engagement.likes": reply.public_metrics?.like_count || 0,
            },
            { upsert: true, new: true }
          );
        }

        results.push({
          postId: post.platformPostId,
          engagement: {
            likes: metrics.like_count || 0,
            retweets: metrics.retweet_count || 0,
            comments: metrics.reply_count || 0,
          },
        });
      } catch (error) {
        console.error(
          `Error fetching Twitter data for post ${post.platformPostId}:`,
          error
        );
      }
    }

    return { success: true, updated: results.length, results };
  } catch (error) {
    console.error("Twitter sync error:", error);
    return { success: false, error: error.message };
  }
}

const FB_GRAPH_VERSION = "v19.0";
const FB_GRAPH_BASE = `https://graph.facebook.com/${FB_GRAPH_VERSION}`;

function parseFbLikes(postData) {
  const likes = postData.likes;
  if (!likes) return Number(postData.reactions?.summary?.total_count) || 0;
  if (typeof likes.summary?.total_count === "number") return likes.summary.total_count;
  if (Array.isArray(likes.data)) return likes.data.length;
  return 0;
}

function parseFbComments(postData) {
  const comments = postData.comments;
  if (!comments) return 0;
  if (typeof comments.summary?.total_count === "number") return comments.summary.total_count;
  if (Array.isArray(comments.data)) return comments.data.length;
  return 0;
}

// Sync Facebook engagement via Graph API (axios). Post/Photo/Video supported.
async function syncFacebookEngagement(account, posts) {
  const token = account.accessToken;
  if (!token) {
    console.error("Facebook sync: no access token");
    return { success: false, error: "No Facebook access token", updated: 0, results: [] };
  }

  console.log("[Facebook sync] Posts to sync:", posts.length, "pageId:", account.pageId);
  const results = [];
  const errors = [];

  for (const post of posts) {
    const nodeId = post.platformPostId;
    try {
      const fields = "likes.summary(true),comments.summary(true)";
      const url = `${FB_GRAPH_BASE}/${nodeId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
      const { data: postData } = await axios.get(url);

      const likesCount = parseFbLikes(postData);
      const commentsCount = parseFbComments(postData);

      let sharesCount = 0;
      try {
        const sharesUrl = `${FB_GRAPH_BASE}/${nodeId}?fields=shares&access_token=${encodeURIComponent(token)}`;
        const { data: sharesData } = await axios.get(sharesUrl);
        sharesCount = Number(sharesData.shares?.count) || 0;
      } catch (e) {
        if (e.response?.data?.error?.code !== 100) {
          console.warn("[Facebook sync] shares", nodeId, e.response?.data?.error?.message || e.message);
        }
      }

      await Post.findByIdAndUpdate(post._id, {
        "engagement.likes": likesCount,
        "engagement.comments": commentsCount,
        "engagement.shares": sharesCount,
        "engagement.lastUpdated": new Date(),
      });

      try {
        const commentsUrl = `${FB_GRAPH_BASE}/${nodeId}/comments?fields=id,message,from,created_time,like_count&access_token=${encodeURIComponent(token)}`;
        const { data: commentsData } = await axios.get(commentsUrl);
        const list = commentsData.data || [];
        for (const comment of list) {
          await Comment.findOneAndUpdate(
            { platformCommentId: comment.id },
            {
              postId: post._id,
              platformCommentId: comment.id,
              platform: "Facebook",
              authorName: comment.from?.name || "Unknown",
              authorId: comment.from?.id,
              content: comment.message,
              createdAt: new Date(comment.created_time),
              "engagement.likes": comment.like_count || 0,
            },
            { upsert: true, new: true }
          );
        }
      } catch (e) {
        console.warn("[Facebook sync] comments list", nodeId, e.response?.data?.error?.message || e.message);
      }

      results.push({
        postId: nodeId,
        engagement: { likes: likesCount, comments: commentsCount, shares: sharesCount },
      });
      console.log("[Facebook sync] OK", nodeId, "likes:", likesCount, "comments:", commentsCount, "shares:", sharesCount);
    } catch (error) {
      const fbErr = error.response?.data?.error || {};
      const msg = fbErr.message || error.message;
      const code = fbErr.code;
      console.error("[Facebook sync] FAIL", nodeId, "code:", code, "message:", msg);
      errors.push({ postId: nodeId, code, message: msg });
      results.push({
        postId: nodeId,
        error: msg,
        engagement: null,
      });
    }
  }

  return {
    success: errors.length === 0,
    updated: results.filter((r) => r.engagement).length,
    results,
    errors: errors.length ? errors : undefined,
  };
}

// Sync LinkedIn engagement data
async function syncLinkedInEngagement(account, posts) {
  try {
    const results = [];

    for (const post of posts) {
      try {
        const response = await axios.get(
          `https://api.linkedin.com/v2/socialActions/${post.platformPostId}`,
          {
            headers: {
              Authorization: `Bearer ${account.accessToken}`,
              "Content-Type": "application/json",
            },
          }
        );

        const engagement = response.data;

        // Update post engagement
        await Post.findByIdAndUpdate(post._id, {
          "engagement.likes": engagement.likesSummary?.totalLikes || 0,
          "engagement.comments":
            engagement.commentsSummary?.totalFirstLevelComments || 0,
          "engagement.shares": engagement.sharesSummary?.totalShares || 0,
          "engagement.lastUpdated": new Date(),
        });

        results.push({
          postId: post.platformPostId,
          engagement: {
            likes: engagement.likesSummary?.totalLikes || 0,
            comments: engagement.commentsSummary?.totalFirstLevelComments || 0,
            shares: engagement.sharesSummary?.totalShares || 0,
          },
        });
      } catch (error) {
        console.error(
          `Error fetching LinkedIn data for post ${post.platformPostId}:`,
          error
        );
      }
    }

    return { success: true, updated: results.length, results };
  } catch (error) {
    console.error("LinkedIn sync error:", error);
    return { success: false, error: error.message };
  }
}

export default router;
