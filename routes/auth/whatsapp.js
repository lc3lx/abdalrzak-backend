import express from "express";
import Account from "../../models/Account.js";
import { authMiddleware } from "../../middleware/auth.js";

const router = express.Router();

// Get WhatsApp Business API connection URL
router.get("/whatsapp/auth", authMiddleware, async (req, res) => {
  try {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!phoneNumberId || !accessToken) {
      return res
        .status(500)
        .json({ error: "WhatsApp Business API not configured" });
    }

    // Create a unique state parameter for security
    const state = `whatsapp_${req.userId}_${Date.now()}`;
    req.session.whatsappState = state;

    // WhatsApp Business API connection URL
    const authUrl = `https://wa.me/${phoneNumberId}?text=${encodeURIComponent(
      "start " + state
    )}`;

    res.json({ url: authUrl });
  } catch (error) {
    console.error("WhatsApp auth error:", error);
    res.status(500).json({ error: "Failed to initiate WhatsApp auth" });
  }
});

// Handle WhatsApp webhook for message verification
router.get("/whatsapp/webhook", async (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    // Verify the webhook
    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log("WhatsApp webhook verified successfully");
      res.status(200).send(challenge);
    } else {
      console.log("WhatsApp webhook verification failed");
      res.status(403).json({ error: "Forbidden" });
    }
  } catch (error) {
    console.error("WhatsApp webhook verification error:", error);
    res.status(500).json({ error: "Webhook verification failed" });
  }
});

// Handle WhatsApp webhook for incoming messages
router.post("/whatsapp/webhook", async (req, res) => {
  try {
    const body = req.body;

    // Check if it's a WhatsApp message
    if (body.object === "whatsapp_business_account") {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (value?.messages) {
        for (const message of value.messages) {
          await processWhatsAppMessage(message, value.metadata);
        }
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("WhatsApp webhook error:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

// Process incoming WhatsApp message
async function processWhatsAppMessage(message, metadata) {
  try {
    const phoneNumberId = metadata.phone_number_id;
    const from = message.from;
    const messageType = message.type;
    const timestamp = message.timestamp;

    // Extract message content based on type
    let content = "";
    let attachments = [];

    if (messageType === "text") {
      content = message.text.body;
    } else if (messageType === "image") {
      content = message.image.caption || "[صورة]";
      attachments = [
        {
          type: "image",
          mediaType: "image",
          mediaId: message.image.id,
        },
      ];
    } else if (messageType === "document") {
      content = message.document.caption || "[مستند]";
      attachments = [
        {
          type: "document",
          mediaType: "document",
          mediaId: message.document.id,
        },
      ];
    } else if (messageType === "audio") {
      content = "[رسالة صوتية]";
      attachments = [
        {
          type: "audio",
          mediaType: "audio",
          mediaId: message.audio.id,
        },
      ];
    } else {
      content = `[${messageType}]`;
    }

    // Find the account associated with this phone number
    const account = await Account.findOne({
      platform: "WhatsApp",
      pageId: phoneNumberId,
    });

    if (!account) {
      console.log("No WhatsApp account found for phone number:", phoneNumberId);
      return;
    }

    // Save the message to database
    const Message = (await import("../../models/Message.js")).default;

    await Message.findOneAndUpdate(
      {
        platformMessageId: message.id,
        platform: "WhatsApp",
      },
      {
        userId: account.userId,
        platform: "WhatsApp",
        platformMessageId: message.id,
        senderId: from,
        senderName: from, // WhatsApp doesn't provide display name in webhook
        content: content,
        messageType: "direct_message",
        receivedAt: new Date(parseInt(timestamp) * 1000),
        attachments: attachments,
        isRead: false,
        isArchived: false,
      },
      { upsert: true, new: true }
    );

    // Trigger auto-reply processing
    await triggerAutoReply(account.userId, message.id);
  } catch (error) {
    console.error("Error processing WhatsApp message:", error);
  }
}

// Trigger auto-reply for WhatsApp message
async function triggerAutoReply(userId, messageId) {
  try {
    const response = await fetch(
      "https://www.sushiluha.com/api/auto-reply/process",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${
            process.env.INTERNAL_API_TOKEN || "internal"
          }`, // You might need to implement internal auth
        },
        body: JSON.stringify({ messageId }),
      }
    );

    if (response.ok) {
      console.log("Auto-reply triggered for WhatsApp message:", messageId);
    }
  } catch (error) {
    console.error("Error triggering auto-reply:", error);
  }
}

// Get WhatsApp account status
router.get("/whatsapp/status", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({
      userId: req.userId,
      platform: "WhatsApp",
    });

    if (!account) {
      return res.json({ connected: false });
    }

    res.json({
      connected: true,
      displayName: account.displayName,
      phoneNumber: account.pageId,
      connectedAt: account.updatedAt,
    });
  } catch (error) {
    console.error("WhatsApp status error:", error);
    res.status(500).json({ error: "Failed to get WhatsApp status" });
  }
});

// Disconnect WhatsApp account
router.delete("/whatsapp/disconnect", authMiddleware, async (req, res) => {
  try {
    await Account.findOneAndDelete({
      userId: req.userId,
      platform: "WhatsApp",
    });

    res.json({ success: true, message: "WhatsApp account disconnected" });
  } catch (error) {
    console.error("WhatsApp disconnect error:", error);
    res.status(500).json({ error: "Failed to disconnect WhatsApp account" });
  }
});

export default router;
