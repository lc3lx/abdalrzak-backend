import express from "express";
import crypto from "crypto";
import Account from "../../models/Account.js";
import Message from "../../models/Message.js";

const router = express.Router();

// Twitter webhook verification
router.get("/twitter/webhook", (req, res) => {
  const crc_token = req.query.crc_token;
  
  if (!crc_token) {
    return res.status(400).json({ error: "Missing crc_token parameter" });
  }

  // Create SHA256 hash using Twitter app consumer secret
  const hmac = crypto.createHmac("sha256", process.env.TWITTER_API_SECRET);
  hmac.update(crc_token);
  const response_token = `sha256=${hmac.digest("base64")}`;

  res.json({ response_token });
});

// Twitter webhook events
router.post("/twitter/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-twitter-webhooks-signature"];
    
    if (!verifyTwitterSignature(req.body, signature)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const { direct_message_events, users } = req.body;

    if (direct_message_events) {
      for (const dmEvent of direct_message_events) {
        await processTwitterDM(dmEvent, users);
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Twitter webhook error:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

// Process Twitter Direct Message
async function processTwitterDM(dmEvent, users) {
  try {
    const senderId = dmEvent.message_create.sender_id;
    const recipientId = dmEvent.message_create.target.recipient_id;
    const messageText = dmEvent.message_create.message_data.text;
    const messageId = dmEvent.id;
    const createdAt = new Date(parseInt(dmEvent.created_timestamp));

    // Find the account that received this message
    const account = await Account.findOne({
      platform: "Twitter",
      platformId: recipientId,
    });

    if (!account) {
      console.log("No Twitter account found for recipient:", recipientId);
      return;
    }

    const senderInfo = users[senderId];

    // Save the message to database
    await Message.findOneAndUpdate(
      { 
        platformMessageId: messageId,
        platform: "Twitter"
      },
      {
        userId: account.userId,
        platform: "Twitter",
        platformMessageId: messageId,
        senderId: senderId,
        senderName: senderInfo?.name || senderInfo?.screen_name || senderId,
        content: messageText,
        messageType: "direct_message",
        receivedAt: createdAt,
        attachments: extractTwitterAttachments(dmEvent.message_create.message_data),
        isRead: false,
        isArchived: false,
      },
      { upsert: true, new: true }
    );

    // Trigger auto-reply processing
    await triggerAutoReply(account.userId, messageId);

  } catch (error) {
    console.error("Error processing Twitter DM:", error);
  }
}

// Extract attachments from Twitter message
function extractTwitterAttachments(messageData) {
  const attachments = [];

  if (messageData.attachment) {
    const attachment = messageData.attachment;
    
    if (attachment.type === "media") {
      attachments.push({
        type: "image",
        mediaType: attachment.media.type,
        mediaUrl: attachment.media.media_url_https,
        mediaId: attachment.media.id_str
      });
    }
  }

  return attachments;
}

// Verify Twitter webhook signature
function verifyTwitterSignature(body, signature) {
  if (!signature || !process.env.TWITTER_API_SECRET) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", process.env.TWITTER_API_SECRET)
    .update(JSON.stringify(body))
    .digest("base64");

  return signature === `sha256=${expectedSignature}`;
}

// Trigger auto-reply for Twitter message
async function triggerAutoReply(userId, messageId) {
  try {
    const response = await fetch("http://localhost:5000/api/auto-reply/process", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.INTERNAL_API_TOKEN || "internal"}`
      },
      body: JSON.stringify({ messageId })
    });

    if (response.ok) {
      console.log("Auto-reply triggered for Twitter message:", messageId);
    }
  } catch (error) {
    console.error("Error triggering auto-reply:", error);
  }
}

export default router;
