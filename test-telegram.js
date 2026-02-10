#!/usr/bin/env node

/**
 * اختبار اتصال التلغرام
 * Telegram Connection Test
 */

import TelegramManager from "./utils/telegram-client.js";
import dotenv from "dotenv";

// تحميل متغيرات البيئة
dotenv.config();

const telegram = new TelegramManager();

async function main() {
  console.log("🚀 بدء اختبار التلغرام\n");

  // التحقق من وجود البيانات المطلوبة
  const apiId = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;
  const phoneNumber = process.env.TELEGRAM_PHONE_NUMBER;

  if (!apiId || !apiHash) {
    console.error(
      "❌ يرجى تعيين TELEGRAM_API_ID و TELEGRAM_API_HASH في ملف .env"
    );
    process.exit(1);
  }

  try {
    // محاولة تحميل الجلسة المحفوظة
    const savedSession = telegram.loadSession();

    // إعداد العميل
    const initialized = await telegram.initialize(apiId, apiHash, savedSession);
    if (!initialized) {
      throw new Error("فشل في إعداد العميل");
    }

    // محاولة الاتصال بالجلسة المحفوظة
    let connected = false;
    if (savedSession) {
      connected = await telegram.connectWithSession();
    }

    // إذا لم ينجح الاتصال، قم بتسجيل الدخول
    if (!connected) {
      if (!phoneNumber) {
        console.error("❌ يرجى تعيين TELEGRAM_PHONE_NUMBER في ملف .env");
        process.exit(1);
      }

      console.log("🔐 لم يتم العثور على جلسة صالحة، جاري تسجيل الدخول...");
      connected = await telegram.login(phoneNumber);
    }

    if (!connected) {
      throw new Error("فشل في تسجيل الدخول");
    }

    // اختبار الوظائف الأساسية
    console.log("\n🧪 جاري اختبار الوظائف...\n");

    // 1. الحصول على معلومات المستخدم
    console.log("1️⃣ اختبار الحصول على معلومات المستخدم:");
    const userInfo = await telegram.getUserInfo();
    if (userInfo) {
      console.log("✅ نجح");
    } else {
      console.log("❌ فشل");
    }

    // 2. الحصول على قائمة المحادثات
    console.log("\n2️⃣ اختبار الحصول على المحادثات:");
    const dialogs = await telegram.getDialogs(10);
    if (dialogs.length > 0) {
      console.log(`✅ نجح - تم العثور على ${dialogs.length} محادثة`);
      dialogs.slice(0, 3).forEach((dialog, index) => {
        console.log(`   ${index + 1}. ${dialog.name} (${dialog.type})`);
      });
    } else {
      console.log("❌ فشل أو لا توجد محادثات");
    }

    // 3. اختبار إرسال رسالة (اختياري)
    if (process.env.TELEGRAM_TEST_CHAT_ID) {
      console.log("\n3️⃣ اختبار إرسال رسالة:");
      const testMessage = await telegram.sendMessage(
        process.env.TELEGRAM_TEST_CHAT_ID,
        "🧪 هذه رسالة اختبار من نظام إدارة وسائل التواصل الاجتماعي"
      );
      if (testMessage) {
        console.log("✅ نجح - تم إرسال الرسالة");
      } else {
        console.log("❌ فشل في إرسال الرسالة");
      }
    }

    console.log("\n🎉 انتهى الاختبار بنجاح!");
    console.log("💡 يمكنك الآن استخدام التلغرام في التطبيق");
  } catch (error) {
    console.error("\n❌ فشل الاختبار:", error.message);
    console.error("\n🔧 حلول مقترحة:");
    console.error("1. تأكد من صحة API_ID و API_HASH");
    console.error("2. تأكد من صحة رقم الهاتف");
    console.error("3. تأكد من تلقي رمز التحقق");
    console.error("4. جرب حذف ملف telegram_session.json وإعادة المحاولة");
  } finally {
    // إغلاق الاتصال
    await telegram.disconnect();
  }
}

// تشغيل الاختبار
main().catch(console.error);
