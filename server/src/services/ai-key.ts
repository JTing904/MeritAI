// The account's AI key (M6 spec §1) and what projects see of their leader's key (§7).
import { AI_REVIEWS_PER_PROJECT_DAY, type AiProviderName } from "../../../shared/constants";
import type { MeData, ProjectAi } from "../../../shared/types";
import type { User } from "../generated/prisma/client";
import { toMe } from "../lib/auth";
import { providerFor } from "../lib/ai";
import { decryptKey, encryptKey, last4 } from "../lib/ai/crypto";
import { redact } from "../lib/ai/redact";
import { AiError } from "../lib/ai/types";
import { effectiveStatus, usageDayStart, usageToday } from "../lib/ai/usage";
import { clock } from "../lib/clock";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import type { Tx } from "./tx";

type Reader = Db | Tx;

/** The user fields a key check needs (select these where the leader's user row is loaded). */
export const AI_USER_SELECT = {
  id: true,
  name: true,
  locale: true,
  aiProvider: true,
  aiKeyCipher: true,
  aiKeyLast4: true,
  aiKeyStatus: true,
  aiKeyCheckedAt: true,
  aiKeyNotice: true,
} as const;

export type AiUser = Pick<User, keyof typeof AI_USER_SELECT>;

/** The user has a key saved. */
export const hasKey = (u: Pick<User, "aiProvider" | "aiKeyCipher"> | null | undefined): boolean => !!u?.aiProvider && !!u.aiKeyCipher;

/** A key the AI may be asked with now: saved and not known to be refused (a QUOTA key is still tried). */
export function keyUsable(u: Pick<User, "aiProvider" | "aiKeyCipher" | "aiKeyStatus" | "aiKeyCheckedAt"> | null | undefined, now: Date): boolean {
  return !!u && hasKey(u) && effectiveStatus(u, now) !== "INVALID";
}

/** The plain key and its provider, or null (none, or it no longer decrypts). Only ever held in memory. */
export function plainKey(u: Pick<User, "id" | "aiProvider" | "aiKeyCipher">): { provider: AiProviderName; key: string } | null {
  if (!u.aiProvider || !u.aiKeyCipher) return null;
  const key = decryptKey(u.aiKeyCipher, u.id);
  return key ? { provider: u.aiProvider, key } : null;
}

/** GET /api/me with today's usage of the key. */
export async function loadMe(db: Reader, user: User, now = clock.now()): Promise<MeData> {
  const usage = user.aiProvider && user.aiKeyCipher ? await usageToday(db, user.id, user.aiProvider, now) : null;
  return toMe(user, usage, now);
}

/**
 * PUT /api/me/ai-key: one cheap call checks the key (nothing is stored when it is refused), then it is
 * saved encrypted, replacing any earlier key; status OK (QUOTA when the check itself said so).
 */
export async function saveKey(
  db: Db,
  user: User,
  input: { provider: AiProviderName; key: string; adult: boolean },
  now = clock.now(),
): Promise<MeData> {
  if (input.adult !== true) throw new AppError(400, "AI_ADULT_REQUIRED", "Confirm you are 18 or older first");
  const key = input.key.trim();
  let status: "OK" | "QUOTA" = "OK";
  try {
    await providerFor(input.provider).checkKey(key);
  } catch (err) {
    if (!(err instanceof AiError)) throw err;
    if (err.kind === "INVALID" || err.kind === "BAD_OUTPUT") throw new AppError(400, "AI_KEY_INVALID", "The key was refused");
    if (err.kind === "QUOTA") status = "QUOTA";
    else {
      console.warn("ai-key: the key check failed", redact(err.message, [key]));
      throw new AppError(503, "AI_UNAVAILABLE", "The AI service couldn't be reached. Try again");
    }
  }
  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      aiProvider: input.provider,
      aiKeyCipher: encryptKey(key, user.id),
      aiKeyLast4: last4(key),
      aiKeyStatus: status,
      aiKeyCheckedAt: now,
      aiAdultConfirmedAt: now,
      aiKeyNotice: null,
    },
  });
  return loadMe(db, updated, now);
}

/** DELETE /api/me/ai-key. Every project the user leads goes back to the free rules. */
export async function deleteKey(db: Db, user: User, now = clock.now()): Promise<MeData> {
  const updated = await db.user.update({
    where: { id: user.id },
    data: { aiProvider: null, aiKeyCipher: null, aiKeyLast4: null, aiKeyStatus: null, aiKeyCheckedAt: null, aiKeyNotice: null },
  });
  return loadMe(db, updated, now);
}

/** AI reviews (GRADE jobs) started in the project since the key's usage day began. */
export async function reviewsToday(db: Reader, projectId: string, provider: AiProviderName, now: Date, taskId?: string): Promise<number> {
  return db.aiJob.count({
    where: { projectId, kind: "GRADE", createdAt: { gte: usageDayStart(provider, now) }, ...(taskId ? { taskId } : {}) },
  });
}

/** ProjectView.ai / TaskDetail.project.ai / DraftView.ai. `leader`: the active leader's user row (null: none). */
export async function projectAi(
  db: Reader,
  projectId: string,
  leader: (Pick<User, "name" | "aiProvider" | "aiKeyCipher" | "aiKeyStatus" | "aiKeyCheckedAt">) | null,
  now: Date,
): Promise<ProjectAi> {
  const configured = hasKey(leader);
  const provider = configured ? leader!.aiProvider! : null;
  return {
    provider,
    configured,
    status: configured ? effectiveStatus(leader!, now) : null,
    leaderName: leader?.name ?? null,
    reviewsToday: provider ? await reviewsToday(db, projectId, provider, now) : 0,
    reviewsLimit: AI_REVIEWS_PER_PROJECT_DAY,
  };
}

/** The project's active leader with the key fields, or null. */
export async function leaderUser(db: Reader, projectId: string): Promise<(AiUser & { memberId: string }) | null> {
  const leader = await db.member.findFirst({
    where: { projectId, role: "LEADER", leftAt: null, removed: false },
    select: { id: true, user: { select: AI_USER_SELECT } },
  });
  return leader ? { ...leader.user, memberId: leader.id } : null;
}
