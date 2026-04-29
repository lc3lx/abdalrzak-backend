import express from "express";
import crypto from "crypto";
import Post from "../../models/Post.js";

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

    await handleTikTokPublishEvent(req.body);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("TikTok webhook error:", error);
    res.status(500).json({ error: "TikTok webhook processing failed" });
  }
});

async function handleTikTokPublishEvent(eventBody) {
  const eventName =
    eventBody.event ||
    eventBody.event_name ||
    eventBody.type ||
    eventBody.event_type;
  const data = eventBody.data || eventBody;
  const publishId = data.publish_id || eventBody.publish_id;

  if (!eventName || !publishId) {
    return;
  }

  const updates = {};

  if (eventName === "post.publish.complete") {
    updates.status = "published";
  } else if (eventName === "post.publish.failed") {
    updates.status = "failed";
    updates.description = data.reason || data.fail_reason || "TikTok publish failed";
  } else if (eventName === "post.publish.inbox_delivered") {
    updates.status = "inbox_delivered";
  } else if (eventName === "post.publish.publicly_available") {
    updates.status = "published";
    if (data.post_id) {
      updates.platformPostId = data.post_id.toString();
      updates.description = `TikTok publish id: ${publishId}`;
    }
  } else if (eventName === "post.publish.no_longer_publicaly_available") {
    updates.status = "not_public";
  }

  if (Object.keys(updates).length === 0) {
    return;
  }

  await Post.findOneAndUpdate(
    { platform: "TikTok", platformPostId: publishId },
    updates
  );
}

export default router;
