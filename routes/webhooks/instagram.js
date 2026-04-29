import express from "express";
import crypto from "crypto";
import Account from "../../models/Account.js";
import Comment from "../../models/Comment.js";
import Message from "../../models/Message.js";
import Post from "../../models/Post.js";

const router = express.Router();

// Instagram webhook verification
router.get("/instagram/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // Verify the webhook
  if (mode === "subscribe" && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
    console.log("Instagram webhook verified successfully");
    res.status(200).send(challenge);
  } else {
    console.log("Instagram webhook verification failed");
    res.status(403).json({ error: "Forbidden" });
  }
});

// Instagram webhook events
router.post("/instagram/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-hub-signature-256"];
    
    if (!verifyInstagramSignature(req.rawBody, req.body, signature)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const { object, entry } = req.body;

    if (object === "instagram") {
      for (const instagramEntry of entry) {
        if (instagramEntry.messaging) {
          for (const messagingEvent of instagramEntry.messaging) {
            await processInstagramMessage(messagingEvent, instagramEntry.id);
          }
        }

        if (instagramEntry.changes) {
          for (const change of instagramEntry.changes) {
            if (change.field === "comments") {
              await processInstagramComment(change.value, instagramEntry.id);
            }
          }
        }
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Instagram webhook error:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

// Process Instagram Message
async function processInstagramMessage(messagingEvent, instagramId) {
  try {
    const senderId = messagingEvent.sender.id;
    const messageId = messagingEvent.message?.mid;
    const messageText = messagingEvent.message?.text || "";
    const timestamp = messagingEvent.timestamp;
    const attachments = extractInstagramAttachments(messagingEvent.message);

    if (messagingEvent.message?.is_echo) {
      return;
    }

    // Skip if no message content
    if (!messageId || (!messageText && attachments.length === 0)) {
      return;
    }

    // Find the account associated with this Instagram account
    const account = await Account.findOne({
      platform: "Instagram",
      platformId: instagramId,
    });

    if (!account) {
      console.log("No Instagram account found for:", instagramId);
      return;
    }

    const savedMessage = await Message.findOneAndUpdate(
      { 
        platformMessageId: messageId,
        platform: "Instagram"
      },
      {
        userId: account.userId,
        platform: "Instagram",
        platformMessageId: messageId,
        senderId: senderId,
        senderName: senderId, // Instagram doesn't provide name in webhook
        content: messageText,
        messageType: "direct_message",
        receivedAt: new Date(timestamp),
        attachments,
        isRead: false,
        isArchived: false,
      },
      { upsert: true, new: true }
    );

    // Trigger auto-reply processing
    await triggerAutoReply(savedMessage._id);

  } catch (error) {
    console.error("Error processing Instagram message:", error);
  }
}

async function processInstagramComment(commentData, instagramId) {
  try {
    const commentId = commentData.id || commentData.comment_id;
    const mediaId = commentData.media?.id || commentData.media_id;
    const commentText = commentData.text || commentData.message || "";
    const from = commentData.from || {};
    const createdTime = commentData.created_time || Date.now();

    if (!commentId || !mediaId || !commentText) {
      return;
    }

    const account = await Account.findOne({
      platform: "Instagram",
      platformId: instagramId,
    });

    if (!account) {
      console.log("No Instagram account found for comment:", instagramId);
      return;
    }

    const post = await Post.findOne({
      userId: account.userId,
      platform: "Instagram",
      platformPostId: mediaId.toString(),
    });

    if (!post) {
      console.log("Instagram post not found for comment media:", mediaId);
      return;
    }

    const comment = await Comment.findOneAndUpdate(
      { platformCommentId: commentId.toString(), platform: "Instagram" },
      {
        postId: post._id,
        platformCommentId: commentId.toString(),
        platform: "Instagram",
        authorName: from.username || from.name || "Instagram User",
        authorId: from.id?.toString(),
        content: commentText,
        createdAt: new Date(createdTime),
        isRead: false,
      },
      { upsert: true, new: true }
    );

    const messageDoc = await Message.findOneAndUpdate(
      {
        platformMessageId: commentId.toString(),
        platform: "Instagram",
        messageType: "comment",
      },
      {
        userId: account.userId,
        platform: "Instagram",
        platformMessageId: commentId.toString(),
        senderId: from.id?.toString(),
        senderName: from.username || from.name || "Instagram User",
        content: commentText,
        messageType: "comment",
        receivedAt: new Date(createdTime),
        isRead: false,
        isArchived: false,
      },
      { upsert: true, new: true }
    );

    await triggerAutoReply(messageDoc._id);
  } catch (error) {
    console.error("Error processing Instagram comment:", error);
  }
}

// Extract attachments from Instagram message
function extractInstagramAttachments(message) {
  const attachments = [];

  if (message.attachments) {
    for (const attachment of message.attachments) {
      if (attachment.type === "image") {
        attachments.push({
          type: "image",
          mediaType: "image",
          mediaUrl: attachment.payload.url
        });
      } else if (attachment.type === "video") {
        attachments.push({
          type: "video",
          mediaType: "video",
          mediaUrl: attachment.payload.url
        });
      }
    }
  }

  return attachments;
}

// Verify Instagram webhook signature
function verifyInstagramSignature(rawBody, body, signature) {
  const appSecret =
    process.env.INSTAGRAM_CLIENT_SECRET || process.env.FACEBOOK_APP_SECRET;
  if (!signature || !appSecret) {
    return false;
  }

  const payload = rawBody || JSON.stringify(body);
  const expectedSignature = crypto
    .createHmac("sha256", appSecret)
    .update(payload)
    .digest("hex");

  const expected = Buffer.from(`sha256=${expectedSignature}`);
  const received = Buffer.from(signature);

  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

// Trigger auto-reply for Instagram message
async function triggerAutoReply(messageId) {
  try {
    const baseUrl = process.env.BASE_URL || "https://www.sushiluha.com";
    const response = await fetch(`${baseUrl}/api/auto-reply/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.INTERNAL_API_TOKEN || "internal"}`
      },
      body: JSON.stringify({ messageId })
    });

    if (response.ok) {
      console.log("Auto-reply triggered for Instagram message:", messageId);
    }
  } catch (error) {
    console.error("Error triggering auto-reply:", error);
  }
}

export default router;
