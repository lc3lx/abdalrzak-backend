import express from "express";
import crypto from "crypto";
import Account from "../../models/Account.js";
import Message from "../../models/Message.js";

const router = express.Router();

// Facebook webhook verification
router.get("/facebook/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // Verify the webhook
  if (mode === "subscribe" && token === process.env.FACEBOOK_VERIFY_TOKEN) {
    console.log("Facebook webhook verified successfully");
    res.status(200).send(challenge);
  } else {
    console.log("Facebook webhook verification failed");
    res.status(403).json({ error: "Forbidden" });
  }
});

// Facebook webhook events
router.post("/facebook/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-hub-signature-256"];
    
    if (!verifyFacebookSignature(req.body, signature)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const { object, entry } = req.body;

    if (object === "page") {
      for (const pageEntry of entry) {
        if (pageEntry.messaging) {
          for (const messagingEvent of pageEntry.messaging) {
            await processFacebookMessage(messagingEvent, pageEntry.id);
          }
        }
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Facebook webhook error:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

// Process Facebook Message
async function processFacebookMessage(messagingEvent, pageId) {
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

    // Find the account associated with this page
    const account = await Account.findOne({
      platform: "Facebook",
      pageId: pageId,
    });

    if (!account) {
      console.log("No Facebook account found for page:", pageId);
      return;
    }

    // Save the message to database
    await Message.findOneAndUpdate(
      { 
        platformMessageId: messageId,
        platform: "Facebook"
      },
      {
        userId: account.userId,
        platform: "Facebook",
        platformMessageId: messageId,
        senderId: senderId,
        senderName: senderId, // Facebook doesn't provide name in webhook
        content: messageText,
        messageType: "direct_message",
        receivedAt: new Date(timestamp),
        attachments: extractFacebookAttachments(messagingEvent.message),
        isRead: false,
        isArchived: false,
      },
      { upsert: true, new: true }
    );

    // Trigger auto-reply processing
    await triggerAutoReply(account.userId, messageId);

  } catch (error) {
    console.error("Error processing Facebook message:", error);
  }
}

// Extract attachments from Facebook message
function extractFacebookAttachments(message) {
  const attachments = [];

  if (message.attachments) {
    for (const attachment of message.attachments) {
      if (attachment.type === "image") {
        attachments.push({
          type: "image",
          mediaType: "image",
          mediaUrl: attachment.payload.url
        });
      } else if (attachment.type === "file") {
        attachments.push({
          type: "file",
          mediaType: "file",
          mediaUrl: attachment.payload.url
        });
      }
    }
  }

  return attachments;
}

// Verify Facebook webhook signature
function verifyFacebookSignature(body, signature) {
  if (!signature || !process.env.FACEBOOK_APP_SECRET) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", process.env.FACEBOOK_APP_SECRET)
    .update(JSON.stringify(body))
    .digest("hex");

  return signature === `sha256=${expectedSignature}`;
}

// Trigger auto-reply for Facebook message
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
      console.log("Auto-reply triggered for Facebook message:", messageId);
    }
  } catch (error) {
    console.error("Error triggering auto-reply:", error);
  }
}

export default router;
