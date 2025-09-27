import express from "express";
import Account from "../../models/Account.js";
import { authMiddleware } from "../../middleware/auth.js";

const router = express.Router();

// Get Telegram bot connection URL
router.get("/telegram/auth", authMiddleware, async (req, res) => {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return res.status(500).json({ error: "Telegram bot not configured" });
    }

    // Create a unique state parameter for security
    const state = `telegram_${req.userId}_${Date.now()}`;
    req.session.telegramState = state;

    // Telegram bot connection URL
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || "YourBotUsername";
    const authUrl = `https://t.me/${botUsername}?start=${state}`;

    res.json({ url: authUrl });
  } catch (error) {
    console.error("Telegram auth error:", error);
    res.status(500).json({ error: "Failed to initiate Telegram auth" });
  }
});

// Handle Telegram webhook for bot authentication
router.post("/telegram/webhook", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || !message.text) {
      return res.status(200).json({ success: true });
    }

    const text = message.text;
    const chatId = message.chat.id;
    const userId = message.from.id;
    const username = message.from.username || message.from.first_name;

    // Check if this is a start command with our state
    if (text.startsWith("/start ")) {
      const state = text.replace("/start ", "");

      // Find the user by state (this is a simplified approach)
      // In production, you'd want to store state in database with expiration
      if (state.startsWith("telegram_")) {
        const userIdFromState = state.split("_")[1];

        // Store the Telegram account
        await Account.findOneAndUpdate(
          { userId: userIdFromState, platform: "Telegram" },
          {
            accessToken: chatId.toString(), // Using chat ID as access token
            displayName: username,
            pageId: userId.toString(), // Using user ID as page ID
          },
          { upsert: true, new: true }
        );

        // Send confirmation message to user
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (botToken) {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: "✅ تم ربط حساب التلغرام بنجاح! يمكنك الآن استخدام الرد التلقائي.",
            }),
          });
        }
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

// Get Telegram account status
router.get("/telegram/status", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({
      userId: req.userId,
      platform: "Telegram",
    });

    if (!account) {
      return res.json({ connected: false });
    }

    res.json({
      connected: true,
      displayName: account.displayName,
      connectedAt: account.updatedAt,
    });
  } catch (error) {
    console.error("Telegram status error:", error);
    res.status(500).json({ error: "Failed to get Telegram status" });
  }
});

// Disconnect Telegram account
router.delete("/telegram/disconnect", authMiddleware, async (req, res) => {
  try {
    await Account.findOneAndDelete({
      userId: req.userId,
      platform: "Telegram",
    });

    res.json({ success: true, message: "Telegram account disconnected" });
  } catch (error) {
    console.error("Telegram disconnect error:", error);
    res.status(500).json({ error: "Failed to disconnect Telegram account" });
  }
});

export default router;
