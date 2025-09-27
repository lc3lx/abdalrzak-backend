import express from "express";
import { google } from "googleapis";
import Account from "../../models/Account.js";
import { authMiddleware } from "../../middleware/auth.js";

const router = express.Router();

// OAuth2 client configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  "http://localhost:5000/api/youtube/callback"
);

// Scopes required for YouTube API
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

router.get("/youtube/auth", authMiddleware, (req, res) => {
  try {
    console.log("Initiating YouTube auth...");

    // Generate auth URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      state: req.userId, // Use userId as state for security
    });

    console.log("YouTube auth URL generated:", authUrl);
    res.json({ url: authUrl });
  } catch (error) {
    console.error("YouTube auth error:", error.message);
    res.status(500).json({ error: "Failed to initiate YouTube auth" });
  }
});

router.get("/youtube/callback", async (req, res) => {
  const { code, state } = req.query;
  const userId = state;

  if (!userId) {
    console.error("YouTube callback failed: No user ID in state");
    return res.status(400).json({ error: "Invalid callback" });
  }

  try {
    console.log("Processing YouTube callback...");

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get channel information
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });
    const channelResponse = await youtube.channels.list({
      part: "snippet,contentDetails",
      mine: true,
    });

    const channel = channelResponse.data.items[0];
    if (!channel) {
      throw new Error("No YouTube channel found");
    }

    // Save account information
    await Account.findOneAndUpdate(
      { userId, platform: "YouTube" },
      {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        displayName: channel.snippet.title,
        platformId: channel.id,
        channelId: channel.id,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      },
      { upsert: true, new: true }
    );

    console.log("YouTube auth completed, connected as:", channel.snippet.title);
    res.send(`
      <script>
        window.opener.postMessage({ type: "AUTH_COMPLETE" }, "*");
        window.close();
      </script>
    `);
  } catch (error) {
    console.error("YouTube callback error:", error.message);
    res.status(500).json({ error: "Failed to complete YouTube auth" });
  }
});

// Refresh token endpoint
router.post("/youtube/refresh", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({
      userId: req.userId,
      platform: "YouTube",
    });

    if (!account || !account.refreshToken) {
      return res.status(404).json({ error: "YouTube account not found" });
    }

    oauth2Client.setCredentials({
      refresh_token: account.refreshToken,
    });

    const { credentials } = await oauth2Client.refreshAccessToken();

    await Account.findOneAndUpdate(
      { userId: req.userId, platform: "YouTube" },
      {
        accessToken: credentials.access_token,
        expiresAt: credentials.expiry_date
          ? new Date(credentials.expiry_date)
          : null,
      }
    );

    res.json({ message: "Token refreshed successfully" });
  } catch (error) {
    console.error("YouTube refresh error:", error.message);
    res.status(500).json({ error: "Failed to refresh token" });
  }
});

// Get channel info endpoint
router.get("/youtube/channel", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({
      userId: req.userId,
      platform: "YouTube",
    });

    if (!account) {
      return res.status(404).json({ error: "YouTube account not found" });
    }

    oauth2Client.setCredentials({
      access_token: account.accessToken,
      refresh_token: account.refreshToken,
    });

    const youtube = google.youtube({ version: "v3", auth: oauth2Client });
    const channelResponse = await youtube.channels.list({
      part: "snippet,statistics",
      mine: true,
    });

    const channel = channelResponse.data.items[0];
    res.json({
      title: channel.snippet.title,
      description: channel.snippet.description,
      subscriberCount: channel.statistics.subscriberCount,
      videoCount: channel.statistics.videoCount,
      viewCount: channel.statistics.viewCount,
    });
  } catch (error) {
    console.error("YouTube channel info error:", error.message);
    res.status(500).json({ error: "Failed to get channel info" });
  }
});

export default router;
