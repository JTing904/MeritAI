import { Hono } from "hono";
import type { NotificationPage, UnreadCount } from "../../../shared/types";
import type { AppEnv } from "../app";
import { requireUser } from "../lib/auth";
import { readBody } from "../lib/body";
import { ok } from "../lib/http";
import { countUnread, listNotifications, markRead } from "../services/notifications";
import { MarkReadSchema, NotificationQuerySchema } from "../services/schemas";

// The signed-in user's notifications (通知 tab).
export const notificationRoutes = new Hono<AppEnv>();

notificationRoutes.get("/", async (c) => {
  const user = await requireUser(c);
  const query = NotificationQuerySchema.parse(c.req.query());
  return ok<NotificationPage>(c, await listNotifications(c.var.db, user.id, query));
});

notificationRoutes.get("/unread-count", async (c) => {
  const user = await requireUser(c);
  return ok<UnreadCount>(c, { count: await countUnread(c.var.db, user.id) });
});

notificationRoutes.post("/read", async (c) => {
  const user = await requireUser(c);
  const { upToId } = await readBody(c, MarkReadSchema);
  return ok<UnreadCount>(c, { count: await markRead(c.var.db, user.id, upToId) });
});
