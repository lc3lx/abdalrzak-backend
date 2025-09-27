import express from "express";
import crypto from "crypto";
import Account from "../../models/Account.js";
import Message from "../../models/Message.js";

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
    
    if (!verifyInstagramSignature(req.body, signature)) {
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
    const recipientId = messagingEvent.recipient.id;
    const messageId = messagingEvent.message?.mid;
    const messageText = messagingEvent.message?.text;
    const timestamp = messagingEvent.timestamp;

    // Skip if no message content
    if (!messageId || !messageText) {
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

    // Save the message to database
    await Message.findOneAndUpdate(
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
        attachments: extractInstagramAttachments(messagingEvent.message),
        isRead: false,
        isArchived: false,
      },
      { upsert: true, new: true }
    );

    // Trigger auto-reply processing
    await triggerAutoReply(account.userId, messageId);

  } catch (error) {
    console.error("Error processing Instagram message:", error);
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
function verifyInstagramSignature(body, signature) {
  if (!signature || !process.env.INSTAGRAM_CLIENT_SECRET) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", process.env.INSTAGRAM_CLIENT_SECRET)
    .update(JSON.stringify(body))
    .digest("hex");

  return signature === `sha256=${expectedSignature}`;
}

// Trigger auto-reply for Instagram message
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
      console.log("Auto-reply triggered for Instagram message:", messageId);
    }
  } catch (error) {
    console.error("Error triggering auto-reply:", error);
  }
}

export default router;
