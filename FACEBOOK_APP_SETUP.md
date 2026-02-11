# إعداد تطبيق فيسبوك لربط الحساب (حل خطأ النطاق 1349048)

## الخطوات بالترتيب

### 1. فتح التطبيق
- ادخل إلى: https://developers.facebook.com/apps
- اختر تطبيقك (أو أنشئ تطبيقاً جديداً)

### 2. إضافة منصة "الموقع" (مهم)
- من القائمة الجانبية: **إعدادات** → **أساسي** (أو **Basic**)
- انزل إلى قسم **إضافة منصة** (Add Platform) أو **منصات التطبيق**
- إذا لم تكن منصة **الموقع (Website)** مضافة، اضغط **إضافة منصة** واختر **الموقع**
- في **رابط الموقع (Site URL)** ضع بالضبط:
  ```
  https://www.sushiluha.com
  ```
- احفظ

### 3. ربط إنستغرام (تطبيق فيه منتج إنستغرام)
- إنستغرام يطلب تطبيق ميتا فيه **منتج إنستغرام** (Instagram API with Instagram Login). إن لم يكن مضافاً تظهر رسالة **Invalid platform app**.
- في تطبيقك: **Add Product** → **Instagram** → إعداد "Instagram API with Instagram Login"، ثم في الإعدادات أضف **Valid OAuth Redirect URIs**: `https://www.sushiluha.com/api/instagram/callback`
- في `.env`: `INSTAGRAM_CLIENT_ID` و `INSTAGRAM_CLIENT_SECRET` = نفس **App ID** و **App Secret** من تطبيقك (من Settings → Basic).
- تفاصيل كاملة: انظر الملف **INSTAGRAM_SETUP.md** في مجلد الباكند.

### 4. نطاقات التطبيق (App Domains)
- في نفس الصفحة **الإعدادات → أساسي**
- ابحث عن حقل **نطاقات التطبيق** (App Domains)
- أضف **سطراً منفصلاً** لكل نطاق (بدون https:// وبدون أي مسار):
  ```
  sushiluha.com
  www.sushiluha.com
  ```
- لا تضف شرطات أو مسافات زائدة
- احفظ التغييرات

### 5. Facebook Login – عناوين إعادة التوجيه
- من القائمة الجانبية: **Facebook Login** (أو **تسجيل الدخول**) → **إعدادات** (Settings)
- ابحث عن **Valid OAuth Redirect URIs**
- أضف هذا الرابط **بالضبط** (نسخ ولصق):
  ```
  https://www.sushiluha.com/api/facebook/callback
  ```
- تأكد أن **Client OAuth Login** و **Web OAuth Login** مفعّلان (نعم)
- احفظ

### 6. التحقق
- انتظر 2–3 دقائق بعد الحفظ
- جرّب ربط فيسبوك مرة أخرى من موقعك

---

إذا استمر الخطأ:
- تأكد أنك تستخدم نفس تطبيق فيسبوك الذي فيه **معرّف التطبيق (App ID)** المستخدم في ملف `.env` (FACEBOOK_APP_ID).
- جرّب إضافة النطاق بدون www فقط: `sushiluha.com` في **نطاقات التطبيق** مع الإبقاء على `www.sushiluha.com` أيضاً.

---

## عرض الإعجابات والتعليقات (خطأ #10 أو Missing Permissions)

إذا ظهر عند «تحديث التفاعل» أن فيسبوك يطلب **pages_read_engagement** أو **Page Public Content Access**:

### 1. إعادة ربط فيسبوك
- من الموقع: **Integrations** → فك ربط فيسبوك ثم ربطه من جديد.
- عند الربط تأكد من الموافقة على كل الصلاحيات (بما فيها الصفحات وقراءة التفاعل).

### 2. إذا التطبيق في وضع «تطوير» (Development)
- في [developers.facebook.com/apps](https://developers.facebook.com/apps) → تطبيقك → **أدوار التطبيق** (App Roles).
- أضف نفسك (أو الحساب الذي يملك الصفحة) كـ **مسؤول** أو **مطوّر** أو **مختبر**.
- ثم أعد ربط فيسبوك من الموقع.

### 3. إذا التطبيق «منشور» (Live)
- صلاحية **pages_read_engagement** قد تحتاج مراجعة من فيسبوك (App Review).
- أو التقديم على ميزة **Page Public Content Access**:  
  [App Review → Permissions and Features](https://developers.facebook.com/docs/apps/review) ثم ابحث عن "Page Public Content Access" وقدم الطلب مع توضيح أن التطبيق يعرض تفاعل منشورات الصفحة (إعجابات، تعليقات، مشاركات) لصاحب الصفحة فقط.
