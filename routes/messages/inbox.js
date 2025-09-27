import express from "express";
import axios from "axios";
import { TwitterApi } from "twitter-api-v2";
import FB from "fb";
import Account from "../../models/Account.js";
import Message from "../../models/Message.js";
import { authMiddleware } from "../../middleware/auth.js";

const router = express.Router();

// Get all messages for user
router.get("/messages", authMiddleware, async (req, res) => {
  try {
    const { platform, isRead, page = 1, limit = 20 } = req.query;

    const query = { userId: req.userId };
    if (platform) query.platform = platform;
    if (isRead !== undefined) query.isRead = isRead === "true";

    const messages = await Message.find(query)
      .sort({ receivedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate("userId", "username email");

    const total = await Message.countDocuments(query);

    res.json({
      messages,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// Mark message as read
router.patch("/messages/:messageId/read", authMiddleware, async (req, res) => {
  try {
    const message = await Message.findOneAndUpdate(
      { _id: req.params.messageId, userId: req.userId },
      { isRead: true },
      { new: true }
    );

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    res.json({ success: true, message });
  } catch (error) {
    console.error("Error marking message as read:", error);
    res.status(500).json({ error: "Failed to mark message as read" });
  }
});

// Archive message
router.patch(
  "/messages/:messageId/archive",
  authMiddleware,
  async (req, res) => {
    try {
      const message = await Message.findOneAndUpdate(
        { _id: req.params.messageId, userId: req.userId },
        { isArchived: true },
        { new: true }
      );

      if (!message) {
        return res.status(404).json({ error: "Message not found" });
      }

      res.json({ success: true, message });
    } catch (error) {
      console.error("Error archiving message:", error);
      res.status(500).json({ error: "Failed to archive message" });
    }
  }
);

// Sync messages from social media platforms
router.post("/messages/sync", authMiddleware, async (req, res) => {
  try {
    const accounts = await Account.find({ userId: req.userId });
    const results = {};

    for (const account of accounts) {
      if (account.platform === "Twitter") {
        results.Twitter = await syncTwitterMessages(account);
      } else if (account.platform === "Facebook") {
        results.Facebook = await syncFacebookMessages(account);
      } else if (account.platform === "LinkedIn") {
        results.LinkedIn = await syncLinkedInMessages(account);
      } else if (account.platform === "Telegram") {
        results.Telegram = await syncTelegramMessages(account);
      } else if (account.platform === "WhatsApp") {
        results.WhatsApp = await syncWhatsAppMessages(account);
      }
    }

    res.json(results);
  } catch (error) {
    console.error("Error syncing messages:", error);
    res.status(500).json({ error: "Failed to sync messages" });
  }
});

// Sync Twitter DMs
async function syncTwitterMessages(account) {
  try {
    const twitterClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: account.accessToken,
      accessSecret: account.accessSecret,
    }).readOnly;

    // Get DMs
    const dmEvents = await twitterClient.v2.dmEvents({
      "dm_event.fields": ["created_at", "text", "attachments"],
      "user.fields": ["username", "name"],
      max_results: 50,
    });

    const results = [];

    for (const event of dmEvents.data?.data || []) {
      if (event.event_type === "MessageCreate") {
        const messageData = event.event;

        await Message.findOneAndUpdate(
          { platformMessageId: messageData.id },
          {
            userId: account.userId,
            platform: "Twitter",
            platformMessageId: messageData.id,
            senderId: messageData.sender_id,
            senderName: messageData.sender_id, // Will be updated with actual name
            content: messageData.text,
            messageType: "direct_message",
            receivedAt: new Date(messageData.created_at),
            attachments:
              messageData.attachments?.media_keys?.map((key) => ({
                type: key,
                mediaType: "image", // Default, would need to fetch actual type
              })) || [],
          },
          { upsert: true, new: true }
        );

        results.push({
          id: messageData.id,
          content: messageData.text,
          sender: messageData.sender_id,
        });
      }
    }

    return { success: true, synced: results.length, results };
  } catch (error) {
    console.error("Twitter messages sync error:", error);
    return { success: false, error: error.message };
  }
}

// Sync Facebook Messages
async function syncFacebookMessages(account) {
  try {
    FB.setAccessToken(account.accessToken);
    const results = [];

    // Get conversations
    const conversations = await new Promise((resolve, reject) => {
      FB.api(
        "/me/conversations",
        {
          fields: "id,updated_time,message_count,participants",
        },
        (res) => (res.error ? reject(res.error) : resolve(res))
      );
    });

    for (const conversation of conversations.data || []) {
      // Get messages from conversation
      const messages = await new Promise((resolve, reject) => {
        FB.api(
          `/${conversation.id}/messages`,
          {
            fields: "id,message,from,created_time,attachments",
          },
          (res) => (res.error ? reject(res.error) : resolve(res))
        );
      });

      for (const message of messages.data || []) {
        await Message.findOneAndUpdate(
          { platformMessageId: message.id },
          {
            userId: account.userId,
            platform: "Facebook",
            platformMessageId: message.id,
            senderId: message.from.id,
            senderName: message.from.name,
            content: message.message || "",
            messageType: "direct_message",
            receivedAt: new Date(message.created_time),
            attachments:
              message.attachments?.data?.map((att) => ({
                type: att.url,
                mediaType: att.type || "unknown",
              })) || [],
          },
          { upsert: true, new: true }
        );

        results.push({
          id: message.id,
          content: message.message,
          sender: message.from.name,
        });
      }
    }

    return { success: true, synced: results.length, results };
  } catch (error) {
    console.error("Facebook messages sync error:", error);
    return { success: false, error: error.message };
  }
}

// Sync LinkedIn Messages
async function syncLinkedInMessages(account) {
  try {
    const results = [];

    // LinkedIn doesn't have a public API for DMs in the same way
    // This would need to be implemented based on LinkedIn's messaging API
    // For now, return empty results
    return { success: true, synced: 0, results: [] };
  } catch (error) {
    console.error("LinkedIn messages sync error:", error);
    return { success: false, error: error.message };
  }
}

// Sync Telegram messages
async function syncTelegramMessages(account) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return { success: false, error: "Telegram bot token not configured" };
    }

    // Get updates from Telegram bot
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/getUpdates?offset=-100&limit=100`
    );
    const data = await response.json();

    if (!data.ok) {
      return { success: false, error: data.description };
    }

    const results = [];
    const chatId = account.accessToken; // This is the chat ID we stored

    for (const update of data.result) {
      if (update.message && update.message.chat.id.toString() === chatId) {
        const message = update.message;

        // Skip messages from the bot itself
        if (message.from.is_bot) continue;

        const messageData = {
          userId: account.userId,
          platform: "Telegram",
          platformMessageId: message.message_id.toString(),
          senderId: message.chat.id.toString(),
          senderName:
            message.from.username || message.from.first_name || "Unknown",
          content: message.text || "",
          messageType: "direct_message",
          receivedAt: new Date(message.date * 1000),
          attachments: message.photo
            ? [{ type: "photo", mediaType: "image" }]
            : [],
          isRead: false,
          isArchived: false,
        };

        await Message.findOneAndUpdate(
          { platformMessageId: messageData.platformMessageId },
          messageData,
          { upsert: true, new: true }
        );

        results.push(messageData);
      }
    }

    return { success: true, synced: results.length, results };
  } catch (error) {
    console.error("Telegram messages sync error:", error);
    return { success: false, error: error.message };
  }
}

// Sync WhatsApp messages
async function syncWhatsAppMessages(account) {
  try {
    if (!account.accessToken || !account.pageId) {
      return { success: false, error: "WhatsApp account not configured" };
    }

    // WhatsApp Business API doesn't have a direct way to fetch messages
    // Messages are received via webhook only
    // This function is mainly for compatibility

    return {
      success: true,
      synced: 0,
      results: [],
      message: "WhatsApp messages are received via webhook only",
    };
  } catch (error) {
    console.error("WhatsApp messages sync error:", error);
    return { success: false, error: error.message };
  }
}

// Reply to a message
router.post("/messages/:messageId/reply", authMiddleware, async (req, res) => {
  try {
    const { content, imageUrl } = req.body;
    const messageId = req.params.messageId;

    if (!content) {
      return res.status(400).json({ error: "Reply content is required" });
    }

    // Get the original message
    const originalMessage = await Message.findOne({
      _id: messageId,
      userId: req.userId,
    });

    if (!originalMessage) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Get the account for the platform
    const account = await Account.findOne({
      userId: req.userId,
      platform: originalMessage.platform,
    });

    if (!account) {
      return res
        .status(404)
        .json({ error: "Account not found for this platform" });
    }

    let replyResult = {};

    // Send reply based on platform
    if (originalMessage.platform === "Twitter") {
      replyResult = await replyToTwitter(
        account,
        originalMessage,
        content,
        imageUrl
      );
    } else if (originalMessage.platform === "Facebook") {
      replyResult = await replyToFacebook(
        account,
        originalMessage,
        content,
        imageUrl
      );
    } else if (originalMessage.platform === "LinkedIn") {
      replyResult = await replyToLinkedIn(
        account,
        originalMessage,
        content,
        imageUrl
      );
    } else if (originalMessage.platform === "Telegram") {
      replyResult = await replyToTelegram(
        account,
        originalMessage,
        content,
        imageUrl
      );
    } else if (originalMessage.platform === "WhatsApp") {
      replyResult = await replyToWhatsApp(
        account,
        originalMessage,
        content,
        imageUrl
      );
    } else {
      return res
        .status(400)
        .json({ error: "Reply not supported for this platform" });
    }

    if (replyResult.success) {
      // Save the reply as a new message
      const replyMessage = new Message({
        userId: req.userId,
        platform: originalMessage.platform,
        platformMessageId: replyResult.messageId,
        senderId: account.userId,
        senderName: account.displayName || "You",
        content: content,
        messageType: "reply",
        receivedAt: new Date(),
        replyToMessageId: originalMessage.platformMessageId,
        threadId: originalMessage.threadId || originalMessage._id.toString(),
        attachments: imageUrl ? [{ type: imageUrl, mediaType: "image" }] : [],
      });

      await replyMessage.save();

      res.json({
        success: true,
        message: "Reply sent successfully",
        replyId: replyMessage._id,
      });
    } else {
      res.status(500).json({ error: replyResult.error });
    }
  } catch (error) {
    console.error("Error sending reply:", error);
    res.status(500).json({ error: "Failed to send reply" });
  }
});

// Reply to Twitter message
async function replyToTwitter(account, originalMessage, content, imageUrl) {
  try {
    const twitterClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: account.accessToken,
      accessSecret: account.accessSecret,
    });

    let replyData = {
      text: content,
      direct_message_id: originalMessage.platformMessageId,
    };

    // If there's an image, upload it first
    if (imageUrl) {
      // Note: This would need actual image upload implementation
      // For now, we'll just include the text
      console.log("Image reply not fully implemented for Twitter DMs");
    }

    const response = await twitterClient.v2.sendDm({
      text: content,
      direct_message_id: originalMessage.platformMessageId,
    });

    return {
      success: true,
      messageId: response.data.id,
    };
  } catch (error) {
    console.error("Twitter reply error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Reply to Facebook message
async function replyToFacebook(account, originalMessage, content, imageUrl) {
  try {
    FB.setAccessToken(account.accessToken);

    const replyData = {
      message: content,
    };

    if (imageUrl) {
      replyData.attachment = {
        type: "image",
        payload: {
          url: imageUrl,
        },
      };
    }

    const response = await new Promise((resolve, reject) => {
      FB.api(
        `/${originalMessage.platformMessageId}/messages`,
        "POST",
        replyData,
        (res) => {
          res.error ? reject(res.error) : resolve(res);
        }
      );
    });

    return {
      success: true,
      messageId: response.id,
    };
  } catch (error) {
    console.error("Facebook reply error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Reply to LinkedIn message
async function replyToLinkedIn(account, originalMessage, content, imageUrl) {
  try {
    // LinkedIn messaging API implementation would go here
    // For now, return a mock success
    return {
      success: true,
      messageId: `linkedin_reply_${Date.now()}`,
    };
  } catch (error) {
    console.error("LinkedIn reply error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Reply to Telegram message
async function replyToTelegram(account, originalMessage, content, imageUrl) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new Error("Telegram bot token not configured");
    }

    const chatId = originalMessage.senderId; // This is the chat ID
    const replyData = {
      chat_id: chatId,
      text: content,
    };

    // Add reply to message if it's a reply
    if (originalMessage.platformMessageId) {
      replyData.reply_to_message_id = parseInt(
        originalMessage.platformMessageId
      );
    }

    // Add image if provided
    if (imageUrl) {
      replyData.photo = imageUrl;
      replyData.caption = content;
    }

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(replyData),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.description || "Failed to send Telegram message");
    }

    return {
      success: true,
      messageId: result.result.message_id.toString(),
    };
  } catch (error) {
    console.error("Telegram reply error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Reply to WhatsApp message
async function replyToWhatsApp(account, originalMessage, content, imageUrl) {
  try {
    if (!account.accessToken || !account.pageId) {
      throw new Error("WhatsApp account not properly configured");
    }

    const recipientPhoneNumber = originalMessage.senderId; // This is the phone number
    const messageData = {
      messaging_product: "whatsapp",
      to: recipientPhoneNumber,
      type: "text",
      text: { body: content },
    };

    // Add image if provided
    if (imageUrl) {
      messageData.type = "image";
      messageData.image = {
        link: imageUrl,
        caption: content,
      };
    }

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${account.pageId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messageData),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.error?.message || "Failed to send WhatsApp message"
      );
    }

    return {
      success: true,
      messageId: result.messages?.[0]?.id || `whatsapp_${Date.now()}`,
    };
  } catch (error) {
    console.error("WhatsApp reply error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Get message statistics
router.get("/messages/stats", authMiddleware, async (req, res) => {
  try {
    const stats = await Message.aggregate([
      { $match: { userId: req.userId } },
      {
        $group: {
          _id: {
            platform: "$platform",
            isRead: "$isRead",
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const formattedStats = {
      total: 0,
      unread: 0,
      byPlatform: {},
    };

    stats.forEach((stat) => {
      const platform = stat._id.platform;
      const isRead = stat._id.isRead;

      if (!formattedStats.byPlatform[platform]) {
        formattedStats.byPlatform[platform] = { total: 0, unread: 0 };
      }

      formattedStats.byPlatform[platform].total += stat.count;
      formattedStats.total += stat.count;

      if (!isRead) {
        formattedStats.byPlatform[platform].unread += stat.count;
        formattedStats.unread += stat.count;
      }
    });

    res.json(formattedStats);
  } catch (error) {
    console.error("Error fetching message stats:", error);
    res.status(500).json({ error: "Failed to fetch message stats" });
  }
});

export default router;
