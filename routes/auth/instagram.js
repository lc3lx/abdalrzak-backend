import express from "express";
import axios from "axios";
import Account from "../../models/Account.js";
import { authMiddleware } from "../../middleware/auth.js";

const router = express.Router();

router.get("/instagram/auth", authMiddleware, (req, res) => {
  try {
    const clientId = process.env.INSTAGRAM_CLIENT_ID || process.env.FACEBOOK_APP_ID;
    const placeholder = /your-instagram-client-id|your-app-id|undefined/i;
    if (!clientId || placeholder.test(String(clientId))) {
      console.error("Instagram auth: INSTAGRAM_CLIENT_ID (or FACEBOOK_APP_ID) missing or placeholder in .env");
      return res.status(500).json({
        error: "Instagram غير مضبوط. أضف INSTAGRAM_CLIENT_ID و INSTAGRAM_CLIENT_SECRET في ملف .env (من تطبيق فيسبوك/إنستغرام).",
      });
    }
    const baseUrl = process.env.BASE_URL || "https://www.sushiluha.com";
    const redirectUri = `${baseUrl}/api/instagram/callback`;
    const url = `https://api.instagram.com/oauth/authorize?client_id=${encodeURIComponent(
      clientId
    )}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&scope=user_profile,user_media,instagram_basic,instagram_content_publish&response_type=code`;
    req.session.userId = req.userId;
    res.json({ url });
  } catch (error) {
    console.error("Instagram auth error:", error.message);
    res.status(500).json({ error: "Failed to initiate Instagram auth" });
  }
});

router.get("/instagram/callback", async (req, res) => {
  const { code } = req.query;
  const { userId } = req.session;
  if (!userId) {
    console.error("Instagram callback failed: Session expired");
    return res.status(400).json({ error: "Session expired" });
  }
  const baseUrl = process.env.BASE_URL || "https://www.sushiluha.com";
  const redirectUri = `${baseUrl}/api/instagram/callback`;

  try {
    const clientId = process.env.INSTAGRAM_CLIENT_ID || process.env.FACEBOOK_APP_ID;
    const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET || process.env.FACEBOOK_APP_SECRET;
    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: "Instagram: INSTAGRAM_CLIENT_ID / INSTAGRAM_CLIENT_SECRET (or FACEBOOK_APP_ID / FACEBOOK_APP_SECRET) missing in .env" });
    }
    const { data } = await axios.post(
      "https://api.instagram.com/oauth/access_token",
      {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }
    );
    const accessToken = data.access_token;
    // Get user info using Instagram Graph API
    const userResponse = await axios.get(
      `https://graph.instagram.com/me?fields=username&access_token=${accessToken}`
    );
    await Account.findOneAndUpdate(
      { userId, platform: "Instagram" },
      { accessToken, displayName: userResponse.data.username },
      { upsert: true, new: true }
    );
    console.log(
      "Instagram auth completed, connected as:",
      userResponse.data.username
    );
    res.send(`
      <script>
        window.opener.postMessage({ type: "AUTH_COMPLETE" }, "*");
        window.close();
      </script>
    `);
  } catch (error) {
    console.error("Instagram callback error:", error.message);
    res.status(500).json({ error: "Failed to complete Instagram auth" });
  }
});

export default router;
