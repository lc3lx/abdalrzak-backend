import express from "express";
import axios from "axios";
import Account from "../../models/Account.js";
import { authMiddleware } from "../../middleware/auth.js";

const router = express.Router();

router.get("/facebook/auth", authMiddleware, (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || "https://www.sushiluha.com";
    const redirectUri = `${baseUrl}/api/facebook/callback`;
    // للتأكد من إعداد فيسبوك: النطاق المطلوب في "نطاقات التطبيق" = نطاق redirect_uri فقط (مثلاً www.sushiluha.com أو sushiluha.com)
    console.log("Facebook redirect_uri (أضف هذا النطاق في فيسبوك):", redirectUri);
    const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${
      process.env.FACEBOOK_APP_ID
    }&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&scope=pages_read_engagement,pages_manage_posts,pages_messaging`;
    req.session.userId = req.userId;
    res.json({ url, redirectUri });
  } catch (error) {
    console.error("Facebook auth error:", error.message);
    res.status(500).json({ error: "Failed to initiate Facebook auth" });
  }
});

// صفحة HTML تظهر عند خطأ من فيسبوك (مثلاً نطاق غير مضاف)
const errorHtml = (message, redirectUri) => `
<!DOCTYPE html>
<html dir="rtl">
<head><meta charset="utf-8"><title>خطأ ربط فيسبوك</title></head>
<body style="font-family: Arial; padding: 20px; text-align: center; max-width: 500px; margin: 40px auto;">
  <h2>⚠️ إعداد تطبيق فيسبوك</h2>
  <p>${message}</p>
  <p><strong>أضف في تطبيق فيسبوك:</strong></p>
  <ul style="text-align: right;">
    <li>الإعدادات → أساسي → <strong>نطاقات التطبيق</strong>: أضف <code>www.sushiluha.com</code> و <code>sushiluha.com</code></li>
    <li>Facebook Login → إعدادات → <strong>Valid OAuth Redirect URIs</strong>: أضف <code>https://www.sushiluha.com/api/facebook/callback</code></li>
    <li>تأكد من وجود منصة <strong>Website</strong> وربطها بموقعك</li>
  </ul>
  <p><button onclick="window.close()">إغلاق</button></p>
</body>
</html>
`;

router.get("/facebook/callback", async (req, res) => {
  const { code, error_code, error_message } = req.query;
  const { userId } = req.session;

  if (error_code) {
    const msg = decodeURIComponent(error_message || "").replace(/\+/g, " ") || "حدث خطأ من فيسبوك.";
    return res.send(errorHtml(msg, null));
  }

  if (!userId) {
    return res.send(errorHtml("انتهت الجلسة. أعد المحاولة بعد تسجيل الدخول.", null));
  }

  if (!code) {
    return res.send(errorHtml("لم يُرجَع رمز من فيسبوك. تأكد من إعدادات النطاق وعناوين إعادة التوجيه.", null));
  }

  const baseUrl = process.env.BASE_URL || "https://www.sushiluha.com";
  const redirectUri = `${baseUrl}/api/facebook/callback`;
  const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${
    process.env.FACEBOOK_APP_ID
  }&client_secret=${
    process.env.FACEBOOK_APP_SECRET
  }&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`;

  try {
    console.log("Processing Facebook callback...");
    const { data } = await axios.get(tokenUrl);
    const userAccessToken = data.access_token;
    const pagesResponse = await axios.get(
      `https://graph.facebook.com/v19.0/me/accounts?access_token=${userAccessToken}`
    );
    const page = pagesResponse.data.data[0];
    if (!page) throw new Error("No pages found for this account");
    await Account.findOneAndUpdate(
      { userId, platform: "Facebook" },
      {
        accessToken: page.access_token,
        pageId: page.id,
        displayName: page.name,
      },
      { upsert: true, new: true }
    );
    console.log("Facebook auth completed, connected as:", page.name);
    res.send(`
      <script>
        window.opener.postMessage({ type: "AUTH_COMPLETE" }, "*");
        window.close();
      </script>
    `);
  } catch (error) {
    console.error("Facebook callback error:", error.message);
    res.status(500).json({ error: "Failed to complete Facebook auth" });
  }
});

export default router;
