import express from "express";
import Account from "../models/Account.js";
import Post from "../models/Post.js";
import TelegramManager from "../utils/telegram-client.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// إعداد اتصال التلغرام الكامل
router.post("/telegram/setup", authMiddleware, async (req, res) => {
  try {
    const { apiId, apiHash, phoneNumber, sessionString } = req.body;

    if (!apiId || !apiHash || !phoneNumber) {
      return res.status(400).json({
        error: "apiId, apiHash, و phoneNumber مطلوبة",
      });
    }

    const telegram = new TelegramManager();

    // إعداد العميل
    const initialized = await telegram.initialize(
      apiId,
      apiHash,
      sessionString
    );
    if (!initialized) {
      return res.status(500).json({ error: "فشل في إعداد عميل التلغرام" });
    }

    // محاولة الاتصال
    let connected = false;
    if (sessionString) {
      connected = await telegram.connectWithSession();
    }

    if (!connected) {
      // إذا لم يكن هناك جلسة صالحة، نحتاج إلى تسجيل دخول تفاعلي
      // هذا يتطلب تطبيق منفصل للتعامل مع التسجيل التفاعلي
      return res.status(200).json({
        success: false,
        message: "يجب إكمال عملية تسجيل الدخول يدوياً",
        requiresManualLogin: true,
        setupData: { apiId, apiHash, phoneNumber },
      });
    }

    // حفظ معلومات الحساب
    const userInfo = await telegram.getUserInfo();
    if (!userInfo) {
      return res
        .status(500)
        .json({ error: "فشل في الحصول على معلومات المستخدم" });
    }

    // حفظ الجلسة والحساب
    const accountSession = await telegram.saveSession();

    await Account.findOneAndUpdate(
      { userId: req.userId, platform: "Telegram" },
      {
        accessToken: accountSession,
        displayName:
          `${userInfo.firstName || ""} ${userInfo.lastName || ""}`.trim() ||
          userInfo.username,
        pageId: userInfo.id.toString(),
        apiId: apiId,
        apiHash: apiHash,
        phoneNumber: phoneNumber,
        isFullApp: true,
        connectedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    await telegram.disconnect();

    res.json({
      success: true,
      message: "تم إعداد التلغرام بنجاح",
      user: {
        id: userInfo.id,
        username: userInfo.username,
        displayName: userInfo.firstName,
      },
    });
  } catch (error) {
    console.error("Telegram setup error:", error);
    res.status(500).json({ error: "فشل في إعداد التلغرام" });
  }
});

// الحصول على قائمة القنوات والمجموعات
router.get("/telegram/channels", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({
      userId: req.userId,
      platform: "Telegram",
      isFullApp: true,
    });

    if (!account) {
      return res.status(404).json({ error: "حساب التلغرام غير متصل" });
    }

    const telegram = new TelegramManager();
    const initialized = await telegram.initialize(
      account.apiId,
      account.apiHash,
      account.accessToken
    );

    if (!initialized) {
      return res.status(500).json({ error: "فشل في إعداد الاتصال" });
    }

    const connected = await telegram.connectWithSession();
    if (!connected) {
      return res.status(401).json({ error: "الجلسة غير صالحة" });
    }

    const dialogs = await telegram.getDialogs(100);
    await telegram.disconnect();

    // تصفية القنوات والمجموعات فقط
    const channels = dialogs.filter((d) => d.type === "channel");
    const groups = dialogs.filter((d) => d.type === "group");

    res.json({
      channels,
      groups,
      total: channels.length + groups.length,
    });
  } catch (error) {
    console.error("Get channels error:", error);
    res.status(500).json({ error: "فشل في الحصول على القنوات" });
  }
});

// نشر منشور في قناة أو مجموعة
router.post("/telegram/post", authMiddleware, async (req, res) => {
  try {
    const { chatId, content, mediaUrl } = req.body;

    if (!chatId || !content) {
      return res.status(400).json({ error: "chatId و content مطلوبة" });
    }

    const account = await Account.findOne({
      userId: req.userId,
      platform: "Telegram",
      isFullApp: true,
    });

    if (!account) {
      return res.status(404).json({ error: "حساب التلغرام غير متصل" });
    }

    const telegram = new TelegramManager();
    const initialized = await telegram.initialize(
      account.apiId,
      account.apiHash,
      account.accessToken
    );

    if (!initialized) {
      return res.status(500).json({ error: "فشل في إعداد الاتصال" });
    }

    const connected = await telegram.connectWithSession();
    if (!connected) {
      return res.status(401).json({ error: "الجلسة غير صالحة" });
    }

    let result;
    if (mediaUrl) {
      // إرسال مع صورة
      result = await telegram.sendPhoto(chatId, mediaUrl, content);
    } else {
      // إرسال نص فقط
      result = await telegram.sendMessage(chatId, content);
    }

    if (!result) {
      await telegram.disconnect();
      return res.status(500).json({ error: "فشل في النشر" });
    }

    // حفظ المنشور في قاعدة البيانات
    const post = await Post.create({
      userId: req.userId,
      platform: "Telegram",
      platformPostId: result.id.toString(),
      content: content,
      imageUrl: mediaUrl,
      status: "published",
    });

    await telegram.disconnect();

    res.json({
      success: true,
      message: "تم النشر بنجاح",
      post: {
        id: post._id,
        platformPostId: result.id,
        content: content,
        publishedAt: post.publishedAt,
      },
    });
  } catch (error) {
    console.error("Post to Telegram error:", error);
    res.status(500).json({ error: "فشل في النشر" });
  }
});

// الحصول على إحصائيات المنشور
router.get("/telegram/post/:postId/stats", authMiddleware, async (req, res) => {
  try {
    const { postId } = req.params;

    // البحث عن المنشور في قاعدة البيانات
    const post = await Post.findOne({
      _id: postId,
      userId: req.userId,
      platform: "Telegram",
    });

    if (!post) {
      return res.status(404).json({ error: "المنشور غير موجود" });
    }

    const account = await Account.findOne({
      userId: req.userId,
      platform: "Telegram",
      isFullApp: true,
    });

    if (!account) {
      return res.status(404).json({ error: "حساب التلغرام غير متصل" });
    }

    const telegram = new TelegramManager();
    const initialized = await telegram.initialize(
      account.apiId,
      account.apiHash,
      account.accessToken
    );

    if (!initialized) {
      return res.status(500).json({ error: "فشل في إعداد الاتصال" });
    }

    const connected = await telegram.connectWithSession();
    if (!connected) {
      return res.status(401).json({ error: "الجلسة غير صالحة" });
    }

    // نحتاج إلى معرفة chatId للحصول على الإحصائيات
    // هذا يتطلب تخزين chatId مع المنشور
    // للآن نعيد البيانات المحفوظة
    const stats = {
      id: post.platformPostId,
      views: 0, // Telegram لا يوفر إحصائيات مفصلة عبر API
      status: post.status,
      publishedAt: post.publishedAt,
    };

    await telegram.disconnect();

    res.json(stats);
  } catch (error) {
    console.error("Get post stats error:", error);
    res.status(500).json({ error: "فشل في الحصول على الإحصائيات" });
  }
});

// تحديث الجلسة
router.post("/telegram/refresh-session", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({
      userId: req.userId,
      platform: "Telegram",
      isFullApp: true,
    });

    if (!account) {
      return res.status(404).json({ error: "حساب التلغرام غير موجود" });
    }

    const telegram = new TelegramManager();
    const initialized = await telegram.initialize(
      account.apiId,
      account.apiHash,
      account.accessToken
    );

    if (!initialized) {
      return res.status(500).json({ error: "فشل في إعداد الاتصال" });
    }

    const connected = await telegram.connectWithSession();
    if (!connected) {
      return res.status(401).json({ error: "الجلسة غير صالحة" });
    }

    // حفظ الجلسة الجديدة
    const newSession = await telegram.saveSession();

    await Account.findByIdAndUpdate(account._id, {
      accessToken: newSession,
      updatedAt: new Date(),
    });

    await telegram.disconnect();

    res.json({
      success: true,
      message: "تم تحديث الجلسة بنجاح",
    });
  } catch (error) {
    console.error("Refresh session error:", error);
    res.status(500).json({ error: "فشل في تحديث الجلسة" });
  }
});

// إزالة الاتصال
router.delete("/telegram/disconnect", authMiddleware, async (req, res) => {
  try {
    await Account.findOneAndDelete({
      userId: req.userId,
      platform: "Telegram",
    });

    res.json({
      success: true,
      message: "تم إزالة الاتصال بنجاح",
    });
  } catch (error) {
    console.error("Disconnect error:", error);
    res.status(500).json({ error: "فشل في إزالة الاتصال" });
  }
});

// التحقق من حالة الاتصال
router.get("/telegram/status", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({
      userId: req.userId,
      platform: "Telegram",
    });

    if (!account) {
      return res.json({ connected: false });
    }

    // إذا كان تطبيق كامل، تحقق من صحة الجلسة
    if (account.isFullApp) {
      const telegram = new TelegramManager();
      const initialized = await telegram.initialize(
        account.apiId,
        account.apiHash,
        account.accessToken
      );

      if (initialized) {
        const connected = await telegram.connectWithSession();
        await telegram.disconnect();

        return res.json({
          connected: connected,
          isFullApp: true,
          displayName: account.displayName,
          connectedAt: account.connectedAt,
        });
      }
    }

    // إذا كان بوت فقط
    res.json({
      connected: true,
      isFullApp: false,
      displayName: account.displayName,
      connectedAt: account.connectedAt,
    });
  } catch (error) {
    console.error("Status check error:", error);
    res.json({ connected: false });
  }
});

export default router;
