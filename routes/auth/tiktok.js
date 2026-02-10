import express from "express";
import axios from "axios";
import Account from "../../models/Account.js";
import { authMiddleware } from "../../middleware/auth.js";

const router = express.Router();

router.get("/tiktok/auth", authMiddleware, (req, res) => {
  try {
    console.log("Initiating TikTok auth...");
    const baseUrl = process.env.BASE_URL || "https://www.sushiluha.com";
    const redirectUri = `${baseUrl}/api/tiktok/callback`;
    const scope = "user.info.basic,video.publish,video.upload";
    const state = Math.random().toString(36).substring(7);

    // Store state in session for verification
    req.session.tiktokState = state;
    req.session.userId = req.userId;

    const url = `https://www.tiktok.com/v2/auth/authorize/?client_key=${
      process.env.TIKTOK_CLIENT_KEY
    }&scope=${scope}&response_type=code&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&state=${state}`;

    console.log("TikTok auth URL generated:", url);
    res.json({ url });
  } catch (error) {
    console.error("TikTok auth error:", error.message);
    res.status(500).json({ error: "Failed to initiate TikTok auth" });
  }
});

router.get("/tiktok/callback", async (req, res) => {
  const { code, state } = req.query;
  const { tiktokState, userId } = req.session;

  if (!userId) {
    console.error("TikTok callback failed: Session expired");
    return res.status(400).json({ error: "Session expired" });
  }

  if (state !== tiktokState) {
    console.error("TikTok callback failed: Invalid state parameter");
    return res.status(400).json({ error: "Invalid state parameter" });
  }

  const baseUrl = process.env.BASE_URL || "https://www.sushiluha.com";
  const redirectUri = `${baseUrl}/api/tiktok/callback`;

  try {
    console.log("Processing TikTok callback...");

    // Exchange code for access token
    const tokenResponse = await axios.post(
      "https://open.tiktokapis.com/v2/oauth/token/",
      {
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      },
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const { access_token, refresh_token, expires_in, scope } =
      tokenResponse.data;

    // Get user info
    const userInfoResponse = await axios.get(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name",
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    const userInfo = userInfoResponse.data.data.user;

    // Save account information
    await Account.findOneAndUpdate(
      { userId, platform: "TikTok" },
      {
        accessToken: access_token,
        refreshToken: refresh_token,
        displayName: userInfo.display_name,
        platformId: userInfo.open_id,
        expiresAt: new Date(Date.now() + expires_in * 1000),
      },
      { upsert: true, new: true }
    );

    console.log("TikTok auth completed, connected as:", userInfo.display_name);
    res.send(`
      <script>
        window.opener.postMessage({ type: "AUTH_COMPLETE" }, "*");
        window.close();
      </script>
    `);
  } catch (error) {
    console.error("TikTok callback error:", error.message);
    res.status(500).json({ error: "Failed to complete TikTok auth" });
  }
});

// Refresh token endpoint
router.post("/tiktok/refresh", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({
      userId: req.userId,
      platform: "TikTok",
    });

    if (!account || !account.refreshToken) {
      return res.status(404).json({ error: "TikTok account not found" });
    }

    const refreshResponse = await axios.post(
      "https://open.tiktokapis.com/v2/oauth/token/",
      {
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: account.refreshToken,
      },
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const { access_token, refresh_token, expires_in } = refreshResponse.data;

    await Account.findOneAndUpdate(
      { userId: req.userId, platform: "TikTok" },
      {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: new Date(Date.now() + expires_in * 1000),
      }
    );

    res.json({ message: "Token refreshed successfully" });
  } catch (error) {
    console.error("TikTok refresh error:", error.message);
    res.status(500).json({ error: "Failed to refresh token" });
  }
});

// Get TikTok account status
router.get("/tiktok/status", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({
      userId: req.userId,
      platform: "TikTok",
    });

    if (!account) {
      return res.json({ connected: false });
    }

    // Check if token is expired or about to expire (within 1 hour)
    const isExpired = account.expiresAt && new Date() > account.expiresAt;
    const expiresSoon = account.expiresAt && new Date(account.expiresAt.getTime() - 3600000) < new Date();

    res.json({
      connected: true,
      displayName: account.displayName,
      platformId: account.platformId,
      connectedAt: account.updatedAt,
      tokenExpired: isExpired,
      tokenExpiresSoon: expiresSoon,
      expiresAt: account.expiresAt,
    });
  } catch (error) {
    console.error("TikTok status error:", error);
    res.status(500).json({ error: "Failed to get TikTok status" });
  }
});

// Disconnect TikTok account
router.delete("/tiktok/disconnect", authMiddleware, async (req, res) => {
  try {
    await Account.findOneAndDelete({
      userId: req.userId,
      platform: "TikTok",
    });

    res.json({ success: true, message: "TikTok account disconnected" });
  } catch (error) {
    console.error("TikTok disconnect error:", error);
    res.status(500).json({ error: "Failed to disconnect TikTok account" });
  }
});

export default router;
