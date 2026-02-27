import express from "express";
import cors from "cors";
import session from "express-session";
import authRoutes from "./routes/auth/index.js";
import twitterRoutes from "./routes/auth/twitter.js";
import facebookRoutes from "./routes/auth/facebook.js";
import instagramRoutes from "./routes/auth/instagram.js";
import linkedinRoutes from "./routes/auth/linkedin.js";
import telegramRoutes from "./routes/auth/telegram.js";
import telegramSetupRoutes from "./routes/auto-reply/telegram-setup.js";
import telegramEnhancedRoutes from "./routes/telegram-enhanced.js";
import whatsappRoutes from "./routes/auth/whatsapp.js";
import whatsappSetupRoutes from "./routes/auto-reply/whatsapp-setup.js";
import tiktokRoutes from "./routes/auth/tiktok.js";
import youtubeRoutes from "./routes/auth/youtube.js";
import youtubePostRoutes from "./routes/posts/youtube.js";
import tiktokPostRoutes from "./routes/posts/tiktok.js";
import generatePostRoutes from "./routes/posts/generate.js";
import postRoutes from "./routes/posts/post.js";
import scheduleRoutes from "./routes/posts/schedule.js";
import webhookRoutes from "./routes/posts/webhook.js";
import twitterWebhookRoutes from "./routes/webhooks/twitter.js";
import facebookWebhookRoutes from "./routes/webhooks/facebook.js";
import instagramWebhookRoutes from "./routes/webhooks/instagram.js";
import tiktokWebhookRoutes from "./routes/webhooks/tiktok.js";
import fetchRoutes from "./routes/posts/fetch.js";
import inboxRoutes from "./routes/messages/inbox.js";
import commentsRoutes from "./routes/comments/comments.js";
import autoReplyFlowRoutes from "./routes/auto-reply/flows.js";
import autoReplyProcessorRoutes from "./routes/auto-reply/processor.js";
import walletRoutes from "./routes/wallet.js";
import accountRoutes from "./routes/accounts.js";
import userRoutes from "./routes/user.js";
import referralRoutes from "./routes/referral.js";
import adminRoutes from "./routes/admin.js";
import packagesRoutes from "./routes/packages.js";
import dashboardRoutes from "./routes/dashboard.js";
import uploadRoutes from "./routes/upload.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
// import { sessionConfig } from "./config/session.js";

const app = express();

app.use(
  cors({
    origin: true, // يقبل من جميع الأصول
    credentials: true,
  })
);
app.use(express.json());
app.use(express.static("uploads")); // Serve uploaded files (images and videos)
app.use(
  session({
    secret: process.env.SESSION_SECRET || "smart-social-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
    },
  })
);

app.use("/api", authRoutes);
app.use("/api", twitterRoutes);
app.use("/api", facebookRoutes);
app.use("/api", instagramRoutes);
app.use("/api", linkedinRoutes);
app.use("/api", telegramRoutes);
app.use("/api", telegramSetupRoutes);
app.use("/api", telegramEnhancedRoutes);
app.use("/api", whatsappRoutes);
app.use("/api", whatsappSetupRoutes);
app.use("/api", tiktokRoutes);
app.use("/api", youtubeRoutes);
app.use("/api", youtubePostRoutes);
app.use("/api", tiktokPostRoutes);
app.use("/api", generatePostRoutes);
app.use("/api", postRoutes);
app.use("/api", scheduleRoutes);
app.use("/api", webhookRoutes);
app.use("/api", twitterWebhookRoutes);
app.use("/api", facebookWebhookRoutes);
app.use("/api", instagramWebhookRoutes);
app.use("/api", tiktokWebhookRoutes);
app.use("/api", fetchRoutes);
app.use("/api", inboxRoutes);
app.use("/api", commentsRoutes);
app.use("/api", autoReplyFlowRoutes);
app.use("/api", autoReplyProcessorRoutes);
app.use("/api", walletRoutes);
app.use("/api", accountRoutes);
app.use("/api", userRoutes);
app.use("/api/referral", referralRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/packages", packagesRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api", uploadRoutes);

// Error handling middleware (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
