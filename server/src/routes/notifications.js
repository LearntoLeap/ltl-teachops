/**
 * notifications.js — Thông báo trong ứng dụng (docs/API.md §11).
 *
 * Realtime qua SSE: lib/notify.js giữ danh sách kết nối đang mở (addStream/removeStream)
 * và tự đẩy sự kiện `notification` mỗi khi notify(...) được gọi ở bất kỳ route nào.
 * Xác thực cho /stream dùng ?token= trên query (EventSource không gửi được header) —
 * đã được lib/auth.js extractToken hỗ trợ sẵn ở hook toàn cục.
 */
import { rows, scalar } from '../db.js';
import env from '../env.js';
import { uuid, bool, paging } from '../lib/validate.js';
import { addStream, removeStream, markRead, markAllRead } from '../lib/notify.js';

/** Cùng luật với CORS ở app.js — route SSE hijack socket nên phải tự gắn header. */
function corsOriginFor(req) {
  const origin = req.headers.origin;
  if (!origin) return null;
  if (env.corsOrigins.includes(origin)) return origin;
  if (/^https:\/\/ltl-teachops[a-z0-9-]*\.vercel\.app$/.test(origin)) return origin;
  return null;
}

export default async function routes(app) {
  /* -------------------- Danh sách thông báo của tôi ----------------------- */
  app.get('/api/notifications', async (req) => {
    const q = req.query || {};
    const { page, limit, offset } = paging(q);
    const unreadOnly = bool(q.unread, 'unread') === true;

    const where = unreadOnly
      ? 'user_id = $1 and read_at is null'
      : 'user_id = $1';

    const total = await scalar(`select count(*) from notifications where ${where}`, [req.user.id]);
    const items = await rows(
      `select * from notifications
        where ${where}
        order by created_at desc
        limit $2 offset $3`,
      [req.user.id, limit, offset]
    );
    const totalUnread = await scalar(
      'select count(*) from notifications where user_id = $1 and read_at is null',
      [req.user.id]
    );

    return { items, total, page, limit, total_unread: totalUnread };
  });

  /* ------------------------------ SSE stream ------------------------------ */
  app.get('/api/notifications/stream', (req, reply) => {
    // hijack: từ đây tự quản socket, Fastify không serialize/send gì nữa.
    // LƯU Ý: hijack bỏ qua cả @fastify/cors nên phải tự gắn header CORS,
    // nếu không trình duyệt sẽ chặn EventSource từ frontend.
    reply.hijack();
    const headers = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',      // tắt buffering nếu có proxy đứng trước
    };
    const allowedOrigin = corsOriginFor(req);
    if (allowedOrigin) {
      headers['Access-Control-Allow-Origin'] = allowedOrigin;
      headers['Vary'] = 'Origin';
    }
    reply.raw.writeHead(200, headers);
    reply.raw.write('retry: 5000\n\n');
    reply.raw.write(': connected\n\n');

    addStream(req.user.id, reply);

    // Giữ kết nối sống qua proxy/timeout trung gian
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': ping\n\n');
      } catch {
        /* socket hỏng — sự kiện close bên dưới sẽ dọn dẹp */
      }
    }, 25_000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      removeStream(req.user.id, reply);
    });
    // KHÔNG return gì — reply đã hijack
  });

  /* --------------------------- Đánh dấu đã đọc ---------------------------- */
  app.post('/api/notifications/:id/read', async (req, reply) => {
    const id = uuid(req.params.id, 'id', { required: true });
    await markRead(req.user.id, id);
    return reply.code(204).send();
  });

  app.post('/api/notifications/read-all', async (req, reply) => {
    await markAllRead(req.user.id);
    return reply.code(204).send();
  });
}
