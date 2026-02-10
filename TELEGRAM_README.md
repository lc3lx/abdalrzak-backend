# دليل استخدام التلغرام في نظام إدارة وسائل التواصل الاجتماعي

## 🚀 البدء السريع

### 1. تثبيت المكتبات المطلوبة

```bash
npm install
```

### 2. إعداد متغيرات البيئة

انسخ `telegram.env.example` إلى `.env` واملأ البيانات المطلوبة:

```bash
cp telegram.env.example .env
```

### 3. الحصول على بيانات التلغرام

1. اذهب إلى [@BotFather](https://t.me/BotFather)
2. اكتب `/newapp`
3. املأ جميع الحقول المطلوبة
4. احصل على `api_id` و `api_hash`

### 4. اختبار الاتصال

```bash
npm run test:telegram
```

## 📋 الطرق المتاحة (API Endpoints)

### إعداد التطبيق

```
POST /api/telegram/setup
```

إعداد اتصال التلغرام الكامل

**البيانات المطلوبة:**

```json
{
  "apiId": "12345678",
  "apiHash": "abcdef1234567890abcdef1234567890",
  "phoneNumber": "+961xxxxxxxxx",
  "sessionString": "optional_existing_session"
}
```

### الحصول على القنوات والمجموعات

```
GET /api/telegram/channels
```

يحصل على قائمة القنوات والمجموعات المتاحة

### النشر في قناة/مجموعة

```
POST /api/telegram/post
```

نشر منشور في قناة أو مجموعة

**البيانات المطلوبة:**

```json
{
  "chatId": "@channel_username أو chat_id رقمي",
  "content": "محتوى المنشور",
  "mediaUrl": "رابط الصورة (اختياري)"
}
```

### الحصول على إحصائيات المنشور

```
GET /api/telegram/post/:postId/stats
```

الحصول على إحصائيات منشور محدد

### تحديث الجلسة

```
POST /api/telegram/refresh-session
```

تحديث جلسة التلغرام إذا انتهت صلاحيتها

### إزالة الاتصال

```
DELETE /api/telegram/disconnect
```

إزالة اتصال التلغرام

### التحقق من حالة الاتصال

```
GET /api/telegram/status
```

التحقق من حالة اتصال التلغرام

## 🔧 الأوامر المفيدة

### اختبار الاتصال

```bash
npm run test:telegram
```

### تشغيل الخادم

```bash
npm run dev
```

### عرض السجلات

```bash
tail -f logs/telegram.log
```

## 📊 أمثلة على الاستخدام

### إعداد التلغرام

```javascript
const response = await fetch("/api/telegram/setup", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    apiId: "12345678",
    apiHash: "abcdef1234567890abcdef1234567890",
    phoneNumber: "+96170123456",
  }),
});
```

### النشر في قناة

```javascript
const response = await fetch("/api/telegram/post", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    chatId: "@my_channel",
    content: "منشور جديد من نظام إدارة وسائل التواصل الاجتماعي 🚀",
    mediaUrl: "https://example.com/image.jpg",
  }),
});
```

### الحصول على القنوات

```javascript
const response = await fetch("/api/telegram/channels", {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

const data = await response.json();
console.log("القنوات:", data.channels);
console.log("المجموعات:", data.groups);
```

## 🔒 الأمان

### نصائح أمنية مهمة:

1. **لا تشارك `api_id` و `api_hash`** مع أي شخص
2. **لا تحفظ `session_string`** في الكود أو الملفات العامة
3. استخدم متغيرات البيئة لجميع المفاتيح الحساسة
4. قم بتدوير الجلسات بانتظام
5. راقب حدود الاستخدام لتجنب الحظر

### تشفير البيانات الحساسة:

```javascript
import crypto from "crypto";

const encrypt = (text) => {
  const cipher = crypto.createCipher("aes-256-cbc", process.env.ENCRYPTION_KEY);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
};
```

## 🐛 استكشاف الأخطاء

### مشاكل شائعة وحلولها:

#### `AUTH_KEY_UNREGISTERED`

**الحل:** أعد تشغيل عملية التسجيل

```bash
rm telegram_session.json
npm run test:telegram
```

#### `PHONE_CODE_INVALID`

**الحل:** تأكد من إدخال رمز التحقق الصحيح

#### `FLOOD_WAIT_X`

**الحل:** انتظر X ثانية قبل إعادة المحاولة

#### `CHANNEL_PRIVATE`

**الحل:** تأكد من إضافة البوت كمسؤول في القناة الخاصة

#### `SESSION_INVALID`

**الحل:** أعد عملية التسجيل وإنشاء جلسة جديدة

## 📈 المراقبة والسجلات

### عرض السجلات:

```bash
tail -f logs/telegram.log
```

### مراقبة استخدام API:

```javascript
// في كل طلب للتلغرام
console.log(`[${new Date().toISOString()}] Telegram API call: ${endpoint}`);

// حفظ إحصائيات الاستخدام
await saveApiUsage({
  platform: "telegram",
  endpoint: endpoint,
  userId: userId,
  timestamp: new Date(),
});
```

## 🔄 النسخ الاحتياطي والاستعادة

### النسخ الاحتياطي للجلسات:

```bash
#!/bin/bash
# backup-telegram-sessions.sh
DATE=$(date +%Y%m%d_%H%M%S)
cp telegram_session.json backups/telegram_session_$DATE.json
echo "تم النسخ الاحتياطي: telegram_session_$DATE.json"
```

### استعادة الجلسة:

```javascript
// تحميل نسخة احتياطية
const backupSession = JSON.parse(
  fs.readFileSync("backups/telegram_session_20231201_120000.json")
);
process.env.TELEGRAM_SESSION_STRING = backupSession.sessionString;
```

## 📚 الموارد الإضافية

- [Telegram API Documentation](https://core.telegram.org/api)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telethon Documentation](https://docs.telethon.dev/)
- [GramJS Documentation](https://gram.js.org/)

## 🆘 الدعم والمساعدة

إذا واجهت مشاكل:

1. تحقق من ملف السجلات: `logs/telegram.log`
2. تأكد من صحة بيانات البيئة
3. جرب إعادة تشغيل الخادم
4. تحقق من حدود الاستخدام لدى تلغرام
5. استخدم وضع التصحيح: `DEBUG=telegram:* npm run dev`

---

**ملاحظة:** تأكد من اتباع قوانين تلغرام وسياسات الاستخدام المقبول. تجنب الإفراط في استخدام API لتجنب الحظر المؤقت أو الدائم.
