// Invites by email or GitHub username. The invitee sees them on their home screen once signed in.
import type { InviteOutcome } from "../../../shared/types";
import type { Member, User } from "../generated/prisma/client";
import type { Db } from "../lib/db";
import { AppError, conflict, notFound } from "../lib/errors";
import { invitesFor, joinProject } from "./join";
import { lockAsMember, TX_OPTIONS } from "./tx";
import { projectEnded } from "../lib/access";
import { clock } from "../lib/clock";

export const MAX_INVITES_PER_REQUEST = 20;
/** Invites waiting for an answer in one project (A6): an invite list is not a mailing list. */
export const MAX_PENDING_INVITES = 30;

export type InviteTarget =
  | { target: string; email: string; githubUsername: null }
  | { target: string; email: null; githubUsername: string }
  | { target: string; invalid: true };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// GitHub's rules: 1–39 letters, digits or single hyphens, not starting or ending with a hyphen.
const GITHUB = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/;

/** One typed target: "name@x.edu" → email, "@name" or "name" → GitHub username; both lower-cased. */
export function parseTarget(raw: string): InviteTarget {
  const value = raw.trim().toLowerCase();
  if (EMAIL.test(value)) return { target: raw, email: value, githubUsername: null };
  const name = value.startsWith("@") ? value.slice(1) : value;
  if (GITHUB.test(name)) return { target: raw, email: null, githubUsername: name };
  return { target: raw, invalid: true };
}

/** Splits on commas, spaces, new lines (and the Chinese comma/semicolon); drops repeats. */
export function splitTargets(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(/[\s,，;；、]+/)) {
    const key = token.toLowerCase().replace(/^@/, "");
    if (!token || seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

export async function createInvites(db: Db, projectId: string, inviter: User, raw: string): Promise<InviteOutcome[]> {
  const tokens = splitTargets(raw);
  if (tokens.length === 0) throw new AppError(400, "VALIDATION", "Enter at least one email or GitHub username");
  if (tokens.length > MAX_INVITES_PER_REQUEST) {
    throw new AppError(400, "VALIDATION", `At most ${MAX_INVITES_PER_REQUEST} people at a time`);
  }

  return db.$transaction(async (tx) => {
    // The lock keeps two people inviting the same address at once from creating two invites; the
    // inviter is re-read under it (they may have left or been removed since the route checked).
    const { project } = await lockAsMember(tx, projectId, inviter.id);
    // Nobody joins a project past its deadline (joinProject refuses it too), so no invites either.
    if (project.status !== "ACTIVE") throw projectEnded();
    let pendingCount = await tx.invite.count({ where: { projectId, status: "PENDING" } });
    const outcomes: InviteOutcome[] = [];
    for (const token of tokens) {
      const t = parseTarget(token);
      if ("invalid" in t) {
        outcomes.push({ target: token, result: "INVALID" });
        continue;
      }
      const user = await tx.user.findFirst({
        where: t.email
          ? { email: { equals: t.email, mode: "insensitive" } }
          : { githubUsername: { equals: t.githubUsername, mode: "insensitive" } },
      });
      if (user) {
        const member = await tx.member.findUnique({ where: { projectId_userId: { projectId, userId: user.id } } });
        if (member && member.leftAt === null && !member.removed) {
          outcomes.push({ target: token, result: "ALREADY_MEMBER" });
          continue;
        }
      }
      // A known user may already be invited under their other address.
      const addresses = [
        ...(t.email ? [{ email: t.email }] : [{ githubUsername: t.githubUsername! }]),
        ...(user ? invitesFor(user) : []),
      ];
      const pending = await tx.invite.findFirst({ where: { projectId, status: "PENDING", OR: addresses } });
      if (pending) {
        outcomes.push({ target: token, result: "ALREADY_INVITED" });
        continue;
      }
      if (pendingCount >= MAX_PENDING_INVITES) {
        throw new AppError(409, "INVITE_LIMIT", `At most ${MAX_PENDING_INVITES} invites can wait for an answer`);
      }
      pendingCount++;
      await tx.invite.create({
        data: { projectId, invitedById: inviter.id, email: t.email, githubUsername: t.githubUsername },
      });
      outcomes.push({ target: token, result: "INVITED" });
    }
    return outcomes;
  }, TX_OPTIONS);
}

/** The invite, if it is addressed to this user; anyone else gets 404. */
async function findMyInvite(db: Db, inviteId: string, user: User) {
  const invite = await db.invite.findUnique({ where: { id: inviteId } });
  const mine =
    invite &&
    ((invite.email !== null && invite.email === user.email?.toLowerCase()) ||
      (invite.githubUsername !== null && invite.githubUsername === user.githubUsername?.toLowerCase()));
  if (!mine) throw notFound("Invite");
  return invite;
}

/** Accepting joins like an invite code does (same rules). Accepting twice is harmless. */
export async function acceptInvite(db: Db, inviteId: string, user: User, now = clock.now()): Promise<Member> {
  const invite = await findMyInvite(db, inviteId, user);
  return db.$transaction(async (tx) => {
    const current = await tx.invite.findUniqueOrThrow({ where: { id: invite.id } });
    if (current.status === "ACCEPTED") {
      const member = await tx.member.findUnique({
        where: { projectId_userId: { projectId: invite.projectId, userId: user.id } },
      });
      if (member && member.leftAt === null && !member.removed) return member;
    }
    if (current.status !== "PENDING" && current.status !== "ACCEPTED") throw conflict("This invite is no longer open");
    const member = await joinProject(tx, invite.projectId, user, now);
    await tx.invite.update({ where: { id: invite.id }, data: { status: "ACCEPTED", respondedAt: current.respondedAt ?? now } });
    return member;
  }, TX_OPTIONS);
}

/** Declining hides every pending invite this user has for that project. */
export async function declineInvite(db: Db, inviteId: string, user: User, now = clock.now()): Promise<void> {
  const invite = await findMyInvite(db, inviteId, user);
  if (invite.status === "DECLINED") return;
  if (invite.status !== "PENDING") throw conflict("This invite is no longer open");
  await db.invite.updateMany({
    where: { projectId: invite.projectId, status: "PENDING", OR: invitesFor(user) },
    data: { status: "DECLINED", respondedAt: now },
  });
}
