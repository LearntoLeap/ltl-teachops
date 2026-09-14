/**
 * app.js — Khởi tạo Fastify: CORS, multipart, rate limit, xác thực, đăng ký route,
 * xử lý lỗi tập trung.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import env from './env.js';
import { AppError, notFound as notFoundErr, tooManyRequests } from './lib/errors.js';
import { authenticate, passwordGate } from './lib/auth.js';

// Route công khai — không yêu cầu token.
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  // Google chuyển trình duyệt về đây sau khi Admin cho phép — không mang theo Bearer
  // token; route tự kiểm `state` (JWT ngắn hạn gắn với Admin đã bấm Kết nối).
  '/api/drive/oauth/callback',
]);

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.isProd ? 'info' : 'debug',
      transport: env.isProd ? undefined : { target: 'pino-pretty', options: { colorize: true } },
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    trustProxy: true,           // đứng sau Caddy → lấy IP thật từ X-Forwarded-For
    bodyLimit: 2 * 1024 * 1024, // JSON tối đa 2MB; tệp đi qua multipart riêng
    disableRequestLogging: env.isProd,
  });

  /* ------------------------------- CORS ---------------------------------- */
  await app.register(cors, {
    origin(origin, cb) {
      // Không có Origin (curl, ứng dụng di động, health check) ⇒ cho qua.
      if (!origin) return cb(null, true);
      if (env.corsOrigins.includes(origin)) return cb(null, true);
      // Cho phép mọi preview deployment của Vercel thuộc dự án này.
      if (/^https:\/\/ltl-teachops[a-z0-9-]*\.vercel\.app$/.test(origin)) return cb(null, true);
      cb(new AppError(403, 'CORS_BLOCKED', `Nguồn ${origin} không được phép gọi API này.`), false);
    },
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });

  /* --------------------- Thân JSON rỗng = object rỗng --------------------- */
  // Nhiều endpoint không cần dữ liệu gửi lên (cấp lại mật khẩu, xoá, đánh dấu
  // đã đọc…). Một số client vẫn đính kèm Content-Type: application/json với
  // thân rỗng; Fastify mặc định coi đó là lỗi. Ở đây nhận là {} cho êm.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (!body || !String(body).trim()) return done(null, {});
    try {
      done(null, JSON.parse(body));
    } catch {
      done(new AppError(400, 'BAD_REQUEST', 'Dữ liệu gửi lên không phải JSON hợp lệ.'), undefined);
    }
  });

  /* ----------------------------- Multipart ------------------------------- */
  await app.register(multipart, {
    limits: {
      // Trần chung = loại lớn nhất (video); storage.js kiểm lại giới hạn riêng từng loại.
      fileSize: Math.max(env.maxUploadBytes, env.maxVideoBytes, env.maxMaterialBytes),
      files: 12,              // đủ cho nhiều ảnh minh chứng một lượt
      fieldSize: 1024 * 1024, // trường `items` JSON của kiểm kê thiết bị có thể dài
    },
  });

  /* ---------------------------- Rate limit ------------------------------- */
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => ({
      error: { code: 'TOO_MANY_REQUESTS', message: tooManyRequests().message },
    }),
  });

  /* ------------------------- Xác thực toàn cục --------------------------- */
  app.addHook('onRequest', async (req, reply) => {
    const path = (req.url || '').split('?')[0];

    // Preflight đã được @fastify/cors xử lý.
    if (req.method === 'OPTIONS') return;
    if (PUBLIC_PATHS.has(path)) return;
    if (!path.startsWith('/api/')) return;

    await authenticate(req, reply);
    await passwordGate(req, reply);
  });

  /* ------------------------------ Health --------------------------------- */
  app.get('/api/health', async () => ({
    ok: true,
    service: 'teachops-api',
    time: new Date().toISOString(),
  }));

  /* --------------------------- Xử lý lỗi tập trung ------------------------
   * PHẢI đăng ký TRƯỚC app.register(route): mỗi register tạo một context con,
   * context chỉ kế thừa error handler đã tồn tại lúc nó được tạo. Gắn sau ⇒
   * lỗi trả về theo định dạng mặc định của Fastify và client mất message tiếng Việt.
   * ---------------------------------------------------------------------- */
  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: `Không có đường dẫn ${req.method} ${req.url}.` },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    // Lỗi nghiệp vụ đã có thông báo tiếng Việt sẵn.
    if (err instanceof AppError) {
      return reply.code(err.status).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }

    // Client gửi Content-Type: application/json nhưng thân rỗng (hay gặp ở các
    // endpoint không cần dữ liệu như reset-password, DELETE). Coi như body rỗng
    // là hợp lệ chứ không phải lỗi hệ thống.
    if (err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
      return reply.code(400).send({
        error: {
          code: 'EMPTY_BODY',
          message: 'Yêu cầu thiếu dữ liệu gửi lên. Vui lòng thử lại.',
        },
      });
    }

    // Lỗi từ @fastify/multipart khi tệp quá lớn.
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Tệp vượt quá ${Math.round(env.maxUploadBytes / 1024 / 1024)}MB.`,
        },
      });
    }
    if (err.code === 'FST_PARTS_LIMIT' || err.code === 'FST_FILES_LIMIT') {
      return reply.code(413).send({
        error: { code: 'TOO_MANY_FILES', message: 'Bạn tải lên quá nhiều tệp trong một lần.' },
      });
    }

    // Lỗi ràng buộc PostgreSQL → thông báo dễ hiểu.
    if (err.code === '23505') {
      return reply.code(409).send({
        error: { code: 'CONFLICT', message: 'Dữ liệu đã tồn tại trong hệ thống.', details: err.detail },
      });
    }
    if (err.code === '23503') {
      return reply.code(409).send({
        error: {
          code: 'FK_VIOLATION',
          message: 'Không thực hiện được vì dữ liệu này đang được tham chiếu ở nơi khác.',
        },
      });
    }
    if (err.code === '23514') {
      return reply.code(422).send({
        error: { code: 'CHECK_VIOLATION', message: 'Giá trị nhập vào nằm ngoài khoảng cho phép.' },
      });
    }
    if (err.validation) {
      return reply.code(400).send({
        error: { code: 'BAD_REQUEST', message: 'Dữ liệu gửi lên không hợp lệ.', details: err.validation },
      });
    }

    req.log.error({ err }, 'Lỗi không lường trước');
    return reply.code(500).send({
      error: {
        code: 'INTERNAL',
        message: 'Hệ thống gặp sự cố, vui lòng thử lại sau.',
        ...(env.isProd ? {} : { details: err.message }),
      },
    });
  });

  /* ------------------------------ Routes --------------------------------- */
  // Mỗi module tự đăng ký prefix của mình.
  const modules = await Promise.all([
    import('./routes/auth.js'),
    import('./routes/users.js'),
    import('./routes/schools.js'),
    import('./routes/classes.js'),
    import('./routes/rooms.js'),
    import('./routes/schedules.js'),
    import('./routes/timesheets.js'),
    import('./routes/attendance.js'),
    import('./routes/devices.js'),
    import('./routes/materials.js'),
    import('./routes/solutions.js'),
    import('./routes/feedback.js'),
    import('./routes/notifications.js'),
    import('./routes/reports.js'),
    import('./routes/files.js'),
    import('./routes/audit.js'),
    import('./routes/search.js'),
    import('./routes/drive.js'),
  ]);
  for (const m of modules) {
    await app.register(m.default);
  }

  void notFoundErr;
  return app;
}

export default buildApp;
