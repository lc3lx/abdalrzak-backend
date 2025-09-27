import express from "express";
import Account from "../../models/Account.js";
import { authMiddleware } from "../../middleware/auth.js";

const router = express.Router();

// Quick setup for Telegram auto-reply without pre-connection
router.post("/telegram/quick-setup", authMiddleware, async (req, res) => {
  try {
    const { botToken, botUsername } = req.body;

    if (!botToken || !botUsername) {
      return res.status(400).json({
        error: "Bot token and username are required",
      });
    }

    // Test the bot token
    const testResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/getMe`
    );
    const botInfo = await testResponse.json();

    if (!testResponse.ok) {
      return res.status(400).json({
        error: "Invalid bot token",
      });
    }

    // Create a temporary account entry for the bot
    const account = await Account.findOneAndUpdate(
      { userId: req.userId, platform: "Telegram" },
      {
        accessToken: botToken,
        displayName: botInfo.result.first_name || botUsername,
        pageId: botInfo.result.id.toString(),
        botUsername: botUsername,
        isQuickSetup: true,
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: "Telegram bot configured successfully",
      account: {
        id: account._id,
        displayName: account.displayName,
        botUsername: account.botUsername,
      },
    });
  } catch (error) {
    console.error("Telegram quick setup error:", error);
    res.status(500).json({ error: "Failed to setup Telegram bot" });
  }
});

// Get bot connection URL for quick setup
router.get("/telegram/connection-url", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({
      userId: req.userId,
      platform: "Telegram",
    });

    if (!account || !account.botUsername) {
      return res.status(404).json({
        error: "Telegram bot not configured",
      });
    }

    const connectionUrl = `https://t.me/${account.botUsername}`;

    res.json({
      success: true,
      connectionUrl,
      botUsername: account.botUsername,
      instructions: [
        "1. اضغط على الرابط أعلاه",
        "2. ابدأ محادثة مع البوت",
        "3. أرسل /start",
        "4. البوت سيربط نفسه تلقائياً بحسابك",
      ],
    });
  } catch (error) {
    console.error("Error getting connection URL:", error);
    res.status(500).json({ error: "Failed to get connection URL" });
  }
});

export default router;
