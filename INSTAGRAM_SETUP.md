# إعداد إنستغرام – حل "Invalid redirect_uri" و "Invalid platform app"

---

## خطأ: Invalid redirect_uri — وين أضيف الرابط؟

معناها إن الرابط اللي بترجع عليه إنستغرام بعد تسجيل الدخول **مو مسجّل** عندك في تطبيق ميتا. لازم تضيفه **بنفس الحروف** (بدون / آخر، ونفس النطاق).

### الخطوات بالترتيب

1. **افتح تطبيقك في ميتا**
   - ادخل: [developers.facebook.com/apps](https://developers.facebook.com/apps)
   - اختر التطبيق اللي استخدمته لربط إنستغرام (نفس الـ App ID اللي في `.env`).

2. **روح على إعدادات إنستغرام**
   - من القائمة اليسار: **Products** (المنتجات) → اضغط **Instagram**.
   - إذا ما في "Instagram": اضغط **Add Product** واختر **Instagram** ثم **Set Up**.
   - بعدين من تحت قسم إنستغرام اختر: **Instagram API with Instagram Login** أو **Configuration** أو **Basic Display** (حسب الواجهة).

3. **دور على "Redirect URI" أو "Valid OAuth Redirect URIs"**
   - في الصفحة راح تلاقي حقل اسمه **Valid OAuth Redirect URIs** أو **Redirect URIs** أو **Client OAuth Redirect**.
   - اضغط **Add URI** أو اكتب الرابط في الحقل.

4. **ضيف الرابط بالضبط (نسخ ولصق)**
   - إذا موقعك: `https://www.sushiluha.com` استخدم:
     ```
     https://www.sushiluha.com/api/instagram/callback
     ```
   - **مهم:** بدون مسافة، بدون `/` في الآخر، نفس الحروف. لو موقعك بدون `www` استخدم:
     ```
     https://sushiluha.com/api/instagram/callback
     ```
   - واتأكد إن في ملف `.env` عندك `BASE_URL` نفس النطاق (مثلاً `BASE_URL=https://www.sushiluha.com` بدون / في الآخر).

5. **احفظ**
   - اضغط **Save Changes** وانتظر دقيقة ثم جرّب ربط إنستغرام من موقعك مرة ثانية.

**لتتأكد أي رابط يرسله السيرفر:** شغّل الباكند واضغط "ربط إنستغرام" من الموقع، وراجع لوج السيرفر — راح يطبع سطر مثل:
`[Instagram auth] Use this EXACT URL in Meta App → Redirect URIs: https://www.sushiluha.com/api/instagram/callback`  
استخدم **نفس هذا الرابط** في حقل Redirect URIs في ميتا.

---

## خطأ: Invalid platform app

خطأ **Invalid platform app** أو **Invalid Request: Invalid platform app** يظهر عندما تطبيق ميتا غير مضبوط لإنستغرام، أو عندما معرّف التطبيق المستخدم لا ينتمي لتطبيق فيه منتج إنستغرام.

### الحل: تطبيق فيه منتج إنستغرام

### 1. إنشاء تطبيق إنستغرام (أو إضافة إنستغرام لتطبيق موجود)

- ادخل إلى: [developers.facebook.com/apps](https://developers.facebook.com/apps)
- **إما:** اضغط **Create App** → اختر نوع **Business** أو **Other** → ثم أضف منتج **Instagram**.
- **أو:** افتح تطبيقك الحالي (مثل تطبيق فيسبوك) → من لوحة التحكم اضغط **Add Product** → ابحث عن **Instagram** → **Set Up**.

مرجع: [Create an Instagram App](https://developers.facebook.com/docs/instagram-platform/create-an-instagram-app)

### 2. تفعيل "Instagram API with Instagram Login"

- من تطبيقك في ميتا: **Products** → **Instagram** → **Instagram API with Instagram Login** (أو **Instagram Login**).
- تأكد أن المنتج مفعّل وأنك تستخدم **Instagram** وليس "Instagram Basic Display" فقط (Basic Display قديم ومحدود).

### 3. إضافة عنوان إعادة التوجيه (Redirect URI)

- داخل **Instagram** → **Instagram API with Instagram Login** (أو **Configuration** / **Basic Display** حسب واجهة التطبيق).
- ابحث عن **Valid OAuth Redirect URIs** أو **Redirect URIs**.
- أضف بالضبط:
  ```
  https://www.sushiluha.com/api/instagram/callback
  ```
- إذا كان موقعك يستخدم نطاقاً آخر، أضف نفس النطاق مع المسار `/api/instagram/callback`.
- احفظ التغييرات.

### 4. أخذ المعرّف والسر

- **App ID** (معرّف التطبيق): من **Settings** → **Basic** → **App ID**.
- **App Secret** (سر التطبيق): من **Settings** → **Basic** → **App Secret** (اضغط Show).

هذا التطبيق نفسه (الذي أضفت له إنستغرام) هو الذي يعطي **نفس** الـ App ID و App Secret؛ لا تحتاج تطبيقاً منفصلاً إلا إذا أنشأت تطبيقاً جديداً خصيصاً لإنستغرام.

### 5. ملف `.env`

في مجلد الباكند ضع (واستبدل القيم بقيم تطبيقك):

```env
INSTAGRAM_CLIENT_ID=معرف_التطبيق_من_الخطوة_4
INSTAGRAM_CLIENT_SECRET=سر_التطبيق_من_الخطوة_4
```

أو إذا كنت تستخدم نفس تطبيق فيسبوك (وفيه منتج إنستغرام مضاف):

```env
INSTAGRAM_CLIENT_ID=نفس_FACEBOOK_APP_ID
INSTAGRAM_CLIENT_SECRET=نفس_FACEBOOK_APP_SECRET
```

### 6. حسابات الاختبار (وضع التطبيق = Development)

- إذا التطبيق في وضع **Development**: الحساب الذي تربطه من موقعك يجب أن يكون مضافاً كـ **Instagram Tester** أو **App Role** (Admin/Developer/Tester) في التطبيق.
- من التطبيق: **Roles** → **Roles** أو **Instagram Testers** → أضف حساب إنستغرام الذي ستجرب به الربط.

### 7. إعادة تشغيل الباكند والتجربة

- أوقف السيرفر ثم شغّله من جديد.
- جرّب ربط إنستغرام من موقعك مرة أخرى.

---

## ملخص أسباب "Invalid platform app"

| السبب | ما تفعله |
|--------|----------|
| التطبيق لا يحتوي منتج إنستغرام | إضافة منتج **Instagram** من لوحة التطبيق ثم إعداد "Instagram API with Instagram Login". |
| redirect_uri غير مضبوط | إضافة `https://www.sushiluha.com/api/instagram/callback` في **Valid OAuth Redirect URIs** داخل إعدادات إنستغرام. |
| استخدام معرّف تطبيق خاطئ | استخدام **App ID** الخاص بنفس التطبيق الذي فيه إنستغرام مضبوط (من Settings → Basic). |
| التطبيق في Development والحساب غير مضاف | إضافة حسابك كـ Instagram Tester أو كدور في التطبيق. |

مراجع ميتا:
- [OAuth Authorize - Instagram Platform](https://developers.facebook.com/docs/instagram-platform/reference/oauth-authorize/)
- [Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login)
