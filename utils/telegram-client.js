import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram/tl/index.js";
import input from "input"; // للإدخال التفاعلي
import fs from "fs";
import path from "path";

class TelegramManager {
  constructor() {
    this.client = null;
    this.sessionFile = path.join(process.cwd(), "telegram_session.json");
  }

  /**
   * إعداد العميل مع بيانات API
   */
  async initialize(apiId, apiHash, sessionString = "") {
    try {
      console.log("🔄 جاري إعداد عميل التلغرام...");

      this.client = new TelegramClient(
        new StringSession(sessionString),
        parseInt(apiId),
        apiHash,
        {
          connectionRetries: 5,
          timeout: 30000,
          requestRetries: 5,
          floodSleepThreshold: 60,
        }
      );

      console.log("✅ تم إعداد العميل بنجاح");
      return true;
    } catch (error) {
      console.error("❌ خطأ في إعداد العميل:", error.message);
      return false;
    }
  }

  /**
   * تسجيل الدخول لأول مرة
   */
  async login(phoneNumber) {
    try {
      console.log("🔐 جاري تسجيل الدخول...");

      await this.client.start({
        phoneNumber: phoneNumber,
        password: async () => {
          const password = await input.text(
            "أدخل كلمة المرور (إذا كان حسابك محمي بكلمة مرور): "
          );
          return password;
        },
        phoneCode: async () => {
          const code = await input.text("أدخل رمز التحقق المرسل إلى تلغرام: ");
          return code;
        },
        onError: (err) => {
          console.error("خطأ في تسجيل الدخول:", err);
        },
      });

      console.log("✅ تم تسجيل الدخول بنجاح");

      // حفظ الجلسة
      await this.saveSession();

      return true;
    } catch (error) {
      console.error("❌ خطأ في تسجيل الدخول:", error.message);
      return false;
    }
  }

  /**
   * الاتصال بالجلسة المحفوظة
   */
  async connectWithSession() {
    try {
      console.log("🔌 جاري الاتصال بالجلسة المحفوظة...");

      await this.client.connect();

      // التحقق من صحة الجلسة
      const isAuthorized = await this.client.isUserAuthorized();

      if (isAuthorized) {
        console.log("✅ تم الاتصال بالجلسة بنجاح");
        return true;
      } else {
        console.log("❌ الجلسة غير صالحة");
        return false;
      }
    } catch (error) {
      console.error("❌ خطأ في الاتصال:", error.message);
      return false;
    }
  }

  /**
   * الحصول على معلومات المستخدم
   */
  async getUserInfo() {
    try {
      const me = await this.client.getMe();
      console.log("👤 معلومات المستخدم:", {
        id: me.id,
        username: me.username,
        firstName: me.firstName,
        lastName: me.lastName,
        phone: me.phone,
      });
      return me;
    } catch (error) {
      console.error("❌ خطأ في الحصول على معلومات المستخدم:", error.message);
      return null;
    }
  }

  /**
   * الحصول على قائمة المحادثات
   */
  async getDialogs(limit = 50) {
    try {
      console.log(`📋 جاري الحصول على ${limit} محادثة...`);

      const dialogs = await this.client.getDialogs({
        limit: limit,
        archived: false,
      });

      const result = dialogs.map((dialog) => ({
        id: dialog.id,
        name: dialog.title || dialog.name,
        type: dialog.isChannel ? "channel" : dialog.isGroup ? "group" : "user",
        username: dialog.username,
        participantsCount: dialog.participantsCount,
        unreadCount: dialog.unreadCount,
      }));

      console.log(`✅ تم العثور على ${result.length} محادثة`);
      return result;
    } catch (error) {
      console.error("❌ خطأ في الحصول على المحادثات:", error.message);
      return [];
    }
  }

  /**
   * الحصول على معلومات القناة
   */
  async getChannelInfo(channelUsername) {
    try {
      console.log(`📺 جاري الحصول على معلومات القناة: ${channelUsername}`);

      const channel = await this.client.getEntity(channelUsername);

      const result = {
        id: channel.id,
        title: channel.title,
        username: channel.username,
        participantsCount: channel.participantsCount,
        type: "channel",
        isPublic: !!channel.username,
        canPost: channel.adminRights?.postMessages || false,
      };

      console.log("✅ معلومات القناة:", result);
      return result;
    } catch (error) {
      console.error("❌ خطأ في الحصول على معلومات القناة:", error.message);
      return null;
    }
  }

  /**
   * نشر رسالة في قناة
   */
  async sendMessage(chatId, message, options = {}) {
    try {
      console.log(`📤 جاري إرسال رسالة إلى ${chatId}...`);

      const result = await this.client.sendMessage(chatId, {
        message: message,
        ...options,
      });

      console.log("✅ تم إرسال الرسالة بنجاح:", result.id);
      return result;
    } catch (error) {
      console.error("❌ خطأ في إرسال الرسالة:", error.message);
      return null;
    }
  }

  /**
   * رفع صورة ونشرها
   */
  async sendPhoto(chatId, photoPath, caption = "") {
    try {
      console.log(`🖼️ جاري رفع الصورة إلى ${chatId}...`);

      const result = await this.client.sendFile(chatId, {
        file: photoPath,
        caption: caption,
      });

      console.log("✅ تم رفع الصورة بنجاح:", result.id);
      return result;
    } catch (error) {
      console.error("❌ خطأ في رفع الصورة:", error.message);
      return null;
    }
  }

  /**
   * الحصول على إحصائيات المنشور
   */
  async getMessageStats(chatId, messageId) {
    try {
      console.log(`📊 جاري الحصول على إحصائيات الرسالة ${messageId}...`);

      const messages = await this.client.getMessages(chatId, {
        ids: [messageId],
      });

      if (messages.length > 0) {
        const message = messages[0];
        const stats = {
          id: message.id,
          views: message.views || 0,
          forwards: message.forwards || 0,
          replies: message.replies?.replies || 0,
          date: message.date,
        };

        console.log("✅ إحصائيات الرسالة:", stats);
        return stats;
      }

      return null;
    } catch (error) {
      console.error("❌ خطأ في الحصول على إحصائيات الرسالة:", error.message);
      return null;
    }
  }

  /**
   * حفظ الجلسة في ملف
   */
  async saveSession() {
    try {
      if (!this.client) return false;

      const sessionString = this.client.session.save();
      const sessionData = {
        sessionString: sessionString,
        createdAt: new Date().toISOString(),
        apiId: this.client.apiId,
        apiHash: this.client.apiHash,
      };

      fs.writeFileSync(this.sessionFile, JSON.stringify(sessionData, null, 2));
      console.log("💾 تم حفظ الجلسة في الملف");
      return sessionString;
    } catch (error) {
      console.error("❌ خطأ في حفظ الجلسة:", error.message);
      return null;
    }
  }

  /**
   * تحميل الجلسة من ملف
   */
  loadSession() {
    try {
      if (!fs.existsSync(this.sessionFile)) {
        console.log("📁 ملف الجلسة غير موجود");
        return null;
      }

      const sessionData = JSON.parse(fs.readFileSync(this.sessionFile, "utf8"));
      console.log("📂 تم تحميل الجلسة من الملف");
      return sessionData.sessionString;
    } catch (error) {
      console.error("❌ خطأ في تحميل الجلسة:", error.message);
      return null;
    }
  }

  /**
   * إغلاق الاتصال
   */
  async disconnect() {
    try {
      if (this.client) {
        await this.client.disconnect();
        console.log("🔌 تم إغلاق الاتصال");
      }
    } catch (error) {
      console.error("❌ خطأ في إغلاق الاتصال:", error.message);
    }
  }

  /**
   * التحقق من حالة الاتصال
   */
  async isConnected() {
    try {
      return this.client && this.client.connected;
    } catch (error) {
      return false;
    }
  }
}

export default TelegramManager;
