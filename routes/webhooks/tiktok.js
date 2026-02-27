import express from "express";
import crypto from "crypto";

const router = express.Router();

function verifyTikTokSignature(body, signatureHeader) {
  if (!signatureHeader || !process.env.TIKTOK_CLIENT_SECRET) {
    return false;
  }

  try {
    const parts = signatureHeader.split(",");
    let timestamp = null;
    let signature = null;

    for (const part of parts) {
      const [key, value] = part.split("=");
      if (key === "t") timestamp = value;
      if (key === "s") signature = value;
    }

    if (!timestamp || !signature) {
      return false;
    }

    const payload = `${timestamp}.${JSON.stringify(body)}`;
    const hmac = crypto.createHmac(
      "sha256",
      process.env.TIKTOK_CLIENT_SECRET
    );
    const expectedSignature = hmac.update(payload).digest("hex");

    const expectedBuf = Buffer.from(expectedSignature, "hex");
    const receivedBuf = Buffer.from(signature, "hex");

    if (expectedBuf.length !== receivedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  } catch (e) {
    console.error("TikTok webhook signature verification error:", e.message);
    return false;
  }
}

router.post("/tiktok/webhook", async (req, res) => {
  try {
    const signatureHeader = req.headers["tiktok-signature"];

    if (!verifyTikTokSignature(req.body, signatureHeader)) {
      console.warn("TikTok webhook: invalid or missing signature");
      return res.status(401).json({ error: "Invalid signature" });
    }

    console.log(
      "TikTok webhook event received:",
      JSON.stringify(req.body, null, 2)
    );

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("TikTok webhook error:", error);
    res.status(500).json({ error: "TikTok webhook processing failed" });
  }
});

export default router;

