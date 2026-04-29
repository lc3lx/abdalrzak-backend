import express from "express";
import crypto from "crypto";
import Account from "../../models/Account.js";
import Message from "../../models/Message.js";
import { authMiddleware } from "../../middleware/auth.js";

const router = express.Router();

router.get("/whatsapp/auth", authMiddleware, async (req, res) => {
  try {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!phoneNumberId || !accessToken) {
      return res
        .status(500)
        .json({ error: "WhatsApp Business API not configured" });
    }

    const state = `whatsapp_${req.userId}_${Date.now()}`;
    req.session.whatsappState = state;

    const authUrl = `https://wa.me/${phoneNumberId}?text=${encodeURIComponent(
      "start " + state
    )}`;

    res.json({ url: authUrl });
  } catch (error) {
    console.error("WhatsApp auth error:", error);
    res.status(500).json({ error: "Failed to initiate WhatsApp auth" });
  }
});

router.get("/whatsapp/webhook", async (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const envTokenMatch = token === process.env.WHATSAPP_VERIFY_TOKEN;
    const storedTokenMatch = await Account.exists({
      platform: "WhatsApp",
      accessSecret: token,
    });

    if (mode === "subscribe" && (envTokenMatch || storedTokenMatch)) {
      console.log("WhatsApp webhook verified successfully");
      return res.status(200).send(challenge);
    }

    console.log("WhatsApp webhook verification failed");
    return res.status(403).json({ error: "Forbidden" });
  } catch (error) {
    console.error("WhatsApp webhook verification error:", error);
    res.status(500).json({ error: "Webhook verification failed" });
  }
});

router.post("/whatsapp/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-hub-signature-256"];
    if (signature && !verifyWhatsAppSignature(req.rawBody, req.body, signature)) {
      console.log("WhatsApp webhook signature verification failed");
      return res.status(401).json({ error: "Invalid signature" });
    }

    const body = req.body;

    if (body.object === "whatsapp_business_account") {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value;

          if (value?.messages) {
            for (const message of value.messages) {
              await processWhatsAppMessage(message, value.metadata, value.contacts);
            }
          }

          if (value?.statuses) {
            for (const status of value.statuses) {
              await processWhatsAppStatus(status);
            }
          }
        }
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("WhatsApp webhook error:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

function verifyWhatsAppSignature(rawBody, body, signature) {
  const appSecret =
    process.env.WHATSAPP_APP_SECRET || process.env.FACEBOOK_APP_SECRET;

  if (!signature || !appSecret) {
    console.warn(
      "WhatsApp webhook signature verification skipped: No app secret configured"
    );
    return true;
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

function parseWhatsAppMessageContent(message) {
  const messageType = message.type;

  if (messageType === "text") {
    return { content: message.text?.body || "", attachments: [] };
  }

  if (messageType === "image") {
    return {
      content: message.image?.caption || "[image]",
      attachments: [
        {
          type: "image",
          mediaType: "image",
          mediaId: message.image?.id,
        },
      ],
    };
  }

  if (messageType === "video") {
    return {
      content: message.video?.caption || "[video]",
      attachments: [
        {
          type: "video",
          mediaType: "video",
          mediaId: message.video?.id,
        },
      ],
    };
  }

  if (messageType === "document") {
    return {
      content: message.document?.caption || "[document]",
      attachments: [
        {
          type: "document",
          mediaType: "document",
          mediaId: message.document?.id,
          fileName: message.document?.filename,
        },
      ],
    };
  }

  if (messageType === "audio") {
    return {
      content: "[audio]",
      attachments: [
        {
          type: "audio",
          mediaType: "audio",
          mediaId: message.audio?.id,
        },
      ],
    };
  }

  if (messageType === "button") {
    return {
      content: message.button?.text || message.button?.payload || "[button]",
      attachments: [],
    };
  }

  if (messageType === "interactive") {
    return {
      content:
        message.interactive?.button_reply?.title ||
        message.interactive?.list_reply?.title ||
        "[interactive]",
      attachments: [],
    };
  }

  return { content: `[${messageType}]`, attachments: [] };
}

async function processWhatsAppMessage(message, metadata, contacts = []) {
  try {
    const phoneNumberId = metadata?.phone_number_id;
    const from = message.from;
    const timestamp = message.timestamp;
    const { content, attachments } = parseWhatsAppMessageContent(message);

    if (!phoneNumberId || !from || !message.id) {
      return;
    }

    const account = await Account.findOne({
      platform: "WhatsApp",
      pageId: phoneNumberId,
    });

    if (!account) {
      console.log("No WhatsApp account found for phone number:", phoneNumberId);
      return;
    }

    const contact = contacts.find((item) => item.wa_id === from);
    const senderName = contact?.profile?.name || from;

    const savedMessage = await Message.findOneAndUpdate(
      {
        platformMessageId: message.id,
        platform: "WhatsApp",
      },
      {
        userId: account.userId,
        platform: "WhatsApp",
        platformMessageId: message.id,
        senderId: from,
        senderName,
        content,
        messageType: "direct_message",
        receivedAt: new Date(Number(timestamp) * 1000),
        attachments,
        threadId: from,
        isRead: false,
        isArchived: false,
      },
      { upsert: true, new: true }
    );

    await triggerAutoReply(savedMessage._id);
  } catch (error) {
    console.error("Error processing WhatsApp message:", error);
  }
}

async function processWhatsAppStatus(status) {
  try {
    await Message.findOneAndUpdate(
      { platformMessageId: status.id, platform: "WhatsApp" },
      { deliveryStatus: status.status }
    );
  } catch (error) {
    console.error("Error processing WhatsApp status:", error);
  }
}

async function triggerAutoReply(messageId) {
  try {
    const baseUrl = process.env.BASE_URL || "https://www.sushiluha.com";
    const response = await fetch(`${baseUrl}/api/auto-reply/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.INTERNAL_API_TOKEN || "internal"}`,
      },
      body: JSON.stringify({ messageId }),
    });

    if (response.ok) {
      console.log("Auto-reply triggered for WhatsApp message:", messageId);
    }
  } catch (error) {
    console.error("Error triggering auto-reply:", error);
  }
}

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
      webhookUrl: account.webhookUrl,
      connectedAt: account.updatedAt,
      capabilities: {
        receiveMessages: true,
        sendMessages: true,
        autoReply: true,
      },
    });
  } catch (error) {
    console.error("WhatsApp status error:", error);
    res.status(500).json({ error: "Failed to get WhatsApp status" });
  }
});

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
