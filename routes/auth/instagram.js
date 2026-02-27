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
    const baseUrl = (process.env.BASE_URL || "https://www.sushiluha.com").replace(/\/$/, "");
    const redirectUri = `${baseUrl}/api/instagram/callback`;
    console.log("[Instagram auth] Use this EXACT URL in Meta App → Redirect URIs:", redirectUri);
    // Instagram Platform: instagram_business_basic required; instagram_business_content_publish for posting
    const scope = "instagram_business_basic,instagram_business_content_publish";
    const state = req.userId?.toString() || "";
    const url = `https://api.instagram.com/oauth/authorize?client_id=${encodeURIComponent(
      clientId
    )}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&scope=${encodeURIComponent(scope)}&response_type=code&state=${encodeURIComponent(state)}`;
    req.session.userId = req.userId;
    res.json({ url });
  } catch (error) {
    console.error("Instagram auth error:", error.message);
    res.status(500).json({ error: "Failed to initiate Instagram auth" });
  }
});

router.get("/instagram/callback", async (req, res) => {
  const code = (req.query.code || "").toString().trim();
  const state = (req.query.state || "").toString().trim();
  let userId = req.session?.userId;
  if (!userId && state) userId = state;
  if (!userId) {
    console.error("Instagram callback: no userId (session expired or state missing)");
    return res.status(400).send(`<html><body dir="rtl"><p>انتهت الجلسة. أعد المحاولة بعد تسجيل الدخول.</p><script>window.close();</script></body></html>`);
  }

  const baseUrl = (process.env.BASE_URL || "https://www.sushiluha.com").replace(/\/$/, "");
  const redirectUri = `${baseUrl}/api/instagram/callback`;

  const clientId = process.env.INSTAGRAM_CLIENT_ID || process.env.FACEBOOK_APP_ID;
  const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET || process.env.FACEBOOK_APP_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).send(`<html><body dir="rtl"><p>Instagram: أضف INSTAGRAM_CLIENT_ID و INSTAGRAM_CLIENT_SECRET في .env</p><script>window.close();</script></body></html>`);
  }

  if (!code) {
    const errDesc = req.query.error_description || req.query.error || "No code returned";
    console.error("Instagram callback: no code:", req.query);
    return res.status(400).send(`<html><body dir="rtl"><p>لم يُرجَع رمز من إنستغرام: ${errDesc}</p><script>window.close();</script></body></html>`);
  }

  try {
    const tokenRes = await axios.post(
      "https://api.instagram.com/oauth/access_token",
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    const data = tokenRes.data;
    if (!data.access_token) {
      console.error("Instagram token response:", data);
      return res.status(500).send(`<html><body dir="rtl"><p>إنستغرام لم يرجّع رمز وصول. راجع لوج السيرفر.</p><script>window.close();</script></body></html>`);
    }
    const accessToken = data.access_token;

    // Skip long-lived exchange: graph.instagram.com rejects both GET and POST for /access_token on this API.
    // Short-lived token (1h) is saved; you can add refresh logic later.

    let displayName = "Instagram";
    let igUserId = data.user_id;
    try {
      const userResponse = await axios.get("https://graph.instagram.com/v18.0/me", {
        params: { fields: "id,username" },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      displayName = userResponse.data?.username || displayName;
      igUserId = userResponse.data?.id || igUserId;
    } catch (e) {
      if (data.user_id) {
        igUserId = data.user_id;
        displayName = displayName === "Instagram" ? `user_${data.user_id}` : displayName;
      }
      console.warn("Instagram /me failed, saving with displayName:", displayName, e.response?.data || e.message);
    }
    await Account.findOneAndUpdate(
      { userId, platform: "Instagram" },
      { accessToken, displayName, platformId: igUserId?.toString() },
      { upsert: true, new: true }
    );
    console.log("Instagram auth completed, user:", displayName);

    res.send(`
      <script>
        window.opener.postMessage({ type: "AUTH_COMPLETE" }, "*");
        window.close();
      </script>
    `);
  } catch (error) {
    const instaErr = error.response?.data;
    const msg = instaErr?.error_message || instaErr?.message || error.message;
    const codeErr = instaErr?.code;
    console.error("Instagram callback error:", codeErr, msg, instaErr);
    res.status(500).send(
      `<html><body dir="rtl"><p><strong>خطأ من إنستغرام:</strong><br>${msg || "Failed to complete Instagram auth"}</p><p>إن استمر الخطأ: تأكد من أن redirect_uri في تطبيق ميتا = ${redirectUri}</p><script>window.close();</script></body></html>`
    );
  }
});

export default router;
