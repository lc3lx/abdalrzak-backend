// Global Error Handler Middleware
export const errorHandler = (err, req, res, next) => {
  console.error("Error:", {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get("User-Agent"),
    timestamp: new Date().toISOString(),
  });

  // Default error response
  let error = {
    success: false,
    message: "حدث خطأ في الخادم",
    timestamp: new Date().toISOString(),
  };

  // Mongoose validation error
  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors).map((val) => val.message);
    error.message = "خطأ في البيانات المدخلة";
    error.details = errors;
    return res.status(400).json(error);
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    error.message = `${field} موجود بالفعل`;
    return res.status(400).json(error);
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    error.message = "رمز المصادقة غير صحيح";
    return res.status(401).json(error);
  }

  if (err.name === "TokenExpiredError") {
    error.message = "رمز المصادقة منتهي الصلاحية";
    return res.status(401).json(error);
  }

  // MongoDB connection errors
  if (err.name === "MongoError" || err.name === "MongooseError") {
    error.message = "خطأ في قاعدة البيانات";
    return res.status(500).json(error);
  }

  // Social media API errors
  if (err.response?.status) {
    const status = err.response.status;
    if (status === 401) {
      error.message = "انتهت صلاحية الربط مع المنصة";
      error.code = "AUTH_EXPIRED";
    } else if (status === 429) {
      error.message = "تم تجاوز حد الطلبات المسموح";
      error.code = "RATE_LIMIT_EXCEEDED";
    } else if (status >= 500) {
      error.message = "خطأ في خدمة المنصة";
      error.code = "PLATFORM_ERROR";
    }
    return res.status(status >= 500 ? 500 : 400).json(error);
  }

  // Network errors
  if (err.code === "ENOTFOUND" || err.code === "ECONNREFUSED") {
    error.message = "خطأ في الاتصال بالشبكة";
    return res.status(503).json(error);
  }

  // File upload errors
  if (err.code === "LIMIT_FILE_SIZE") {
    error.message = "حجم الملف كبير جداً";
    return res.status(413).json(error);
  }

  // Default server error
  const statusCode = err.statusCode || 500;
  
  // Don't leak error details in production
  if (process.env.NODE_ENV === "production") {
    error.message = statusCode === 500 ? "حدث خطأ في الخادم" : err.message;
  } else {
    error.message = err.message;
    error.stack = err.stack;
  }

  res.status(statusCode).json(error);
};

// Async error wrapper
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// 404 handler
export const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: "المسار غير موجود",
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
  });
};
