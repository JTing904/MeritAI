// 做到这些才算完成 (M4 spec §2): the leader or the owner edits the list; only the owner ticks.
import type { Db } from "../lib/db";
import { AppError, forbidden, notFound } from "../lib/errors";
import type { ChecklistBody } from "./schemas";
import { lockAsMember, TX_OPTIONS, type Tx } from "./tx";
import { clock } from "../lib/clock";

async function findTask(tx: Tx, projectId: string, taskId: string) {
  const task = await tx.task.findFirst({ where: { id: taskId, projectId }, select: { id: true, ownerId: true } });
  if (!task) throw notFound("Task");
  return task;
}

/** Replace-all: items keep their tick by id, new ones start unticked, missing ids are deleted, array order = order. */
export async function replaceChecklist(
  db: Db,
  projectId: string,
  taskId: string,
  userId: string,
  input: ChecklistBody,
  _now = clock.now(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    const { member } = await lockAsMember(tx, projectId, userId);
    const task = await findTask(tx, projectId, taskId);
    if (member.role !== "LEADER" && task.ownerId !== member.id) {
      throw forbidden("Only the leader or the task's owner can edit its checklist");
    }
    const existing = new Set((await tx.checklistItem.findMany({ where: { taskId }, select: { id: true } })).map((i) => i.id));
    const kept = input.items.map((i) => i.id).filter((id): id is string => !!id);
    if (new Set(kept).size !== kept.length) throw new AppError(400, "VALIDATION", "An item is listed twice");
    if (kept.some((id) => !existing.has(id))) throw new AppError(400, "VALIDATION", "Unknown checklist item");

    await tx.checklistItem.deleteMany({ where: { taskId, id: { notIn: kept } } });
    for (const [order, item] of input.items.entries()) {
      if (item.id) {
        await tx.checklistItem.update({ where: { id: item.id }, data: { text: item.text, order } });
      } else {
        await tx.checklistItem.create({ data: { taskId, text: item.text, order } });
      }
    }
  }, TX_OPTIONS);
}

/** Ticks or unticks one item (the task's owner only). */
export async function tickItem(
  db: Db,
  projectId: string,
  taskId: string,
  userId: string,
  itemId: string,
  done: boolean,
  _now = clock.now(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    const { member } = await lockAsMember(tx, projectId, userId);
    const task = await findTask(tx, projectId, taskId);
    const item = await tx.checklistItem.findFirst({ where: { id: itemId, taskId }, select: { id: true } });
    if (!item) throw notFound("Checklist item");
    if (task.ownerId === null || task.ownerId !== member.id) throw forbidden("Only the task's owner ticks its checklist");
    await tx.checklistItem.update({ where: { id: item.id }, data: { done } });
  }, TX_OPTIONS);
}
