import express from "express";
import Account from "../../models/Account.js";
import { authMiddleware } from "../../middleware/auth.js";

const router = express.Router();

// Quick setup for WhatsApp Business API without pre-connection
router.post("/whatsapp/quick-setup", authMiddleware, async (req, res) => {
  try {
    const { phoneNumberId, accessToken, verifyToken, webhookUrl } = req.body;

    if (!phoneNumberId || !accessToken || !verifyToken) {
      return res.status(400).json({
        error: "Phone Number ID, Access Token, and Verify Token are required",
      });
    }

    // Test the WhatsApp Business API
    const testResponse = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!testResponse.ok) {
      const errorData = await testResponse.json();
      return res.status(400).json({
        error: `Invalid credentials: ${
          errorData.error?.message || "Unknown error"
        }`,
      });
    }

    const phoneInfo = await testResponse.json();

    // Create a temporary account entry for the WhatsApp Business
    const account = await Account.findOneAndUpdate(
      { userId: req.userId, platform: "WhatsApp" },
      {
        accessToken: accessToken,
        displayName: phoneInfo.display_phone_number || phoneNumberId,
        pageId: phoneNumberId,
        accessSecret: verifyToken, // Store verify token in accessSecret field
        webhookUrl: webhookUrl,
        isQuickSetup: true,
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: "WhatsApp Business API configured successfully",
      account: {
        id: account._id,
        displayName: account.displayName,
        phoneNumber: account.pageId,
      },
      webhookUrl: `${
        process.env.BASE_URL || "http://localhost:5000"
      }/api/whatsapp/webhook`,
    });
  } catch (error) {
    console.error("WhatsApp quick setup error:", error);
    res.status(500).json({ error: "Failed to setup WhatsApp Business API" });
  }
});

// Get WhatsApp Business API configuration info
router.get("/whatsapp/config-info", authMiddleware, async (req, res) => {
  try {
    res.json({
      success: true,
      instructions: [
        "1. اذهب إلى Facebook Developers Console",
        "2. أنشئ تطبيق جديد أو استخدم تطبيق موجود",
        "3. أضف WhatsApp Business API",
        "4. احصل على Phone Number ID و Access Token",
        "5. أنشئ Verify Token (أي نص تريده)",
        "6. أضف Webhook URL في إعدادات التطبيق",
        "7. استخدم المعلومات في الإعداد السريع",
      ],
      requiredFields: ["Phone Number ID", "Access Token", "Verify Token"],
      webhookUrl: `${
        process.env.BASE_URL || "http://localhost:5000"
      }/api/whatsapp/webhook`,
    });
  } catch (error) {
    console.error("Error getting config info:", error);
    res.status(500).json({ error: "Failed to get configuration info" });
  }
});

// Test WhatsApp message sending
router.post("/whatsapp/test-message", authMiddleware, async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;

    if (!phoneNumber || !message) {
      return res.status(400).json({
        error: "Phone number and message are required",
      });
    }

    const account = await Account.findOne({
      userId: req.userId,
      platform: "WhatsApp",
    });

    if (!account) {
      return res.status(404).json({
        error: "WhatsApp account not configured",
      });
    }

    // Send test message
    const response = await fetch(
      `https://graph.facebook.com/v19.0/${account.pageId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phoneNumber,
          type: "text",
          text: { body: message },
        }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return res.status(400).json({
        error: `Failed to send message: ${
          result.error?.message || "Unknown error"
        }`,
      });
    }

    res.json({
      success: true,
      message: "Test message sent successfully",
      messageId: result.messages?.[0]?.id,
    });
  } catch (error) {
    console.error("WhatsApp test message error:", error);
    res.status(500).json({ error: "Failed to send test message" });
  }
});

export default router;
