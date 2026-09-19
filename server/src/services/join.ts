// Joining a project: by invite code (no approval) or by accepting an invite. Both use joinProject().
import type { JoinPreview } from "../../../shared/types";
import type { Member, Prisma, Project, User } from "../generated/prisma/client";
import { isActiveMember } from "../lib/access";
import { pickMemberColor } from "../lib/colors";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import { normalizeInviteCode } from "../lib/invite-code";
import { bumpPackages, recordEvent, remindPackageless } from "./notify";
import { lockProject, TX_OPTIONS, type Tx } from "./tx";
import { sortLeaderFirst } from "./views";

/** A team has at most this many active members (REQUIREMENTS §13); the next one to join gets TEAM_FULL. */
export const MAX_ACTIVE_MEMBERS = 8;

const projectEnded = () => new AppError(409, "PROJECT_ENDED", "The project has ended");

/** The project behind an invite code. Unknown → INVITE_CODE_INVALID; replaced by 重新生成 → INVITE_CODE_EXPIRED. */
export async function findProjectByCode(db: Tx, rawCode: string): Promise<Project> {
  const code = normalizeInviteCode(rawCode);
  const project = code ? await db.project.findUnique({ where: { inviteCode: code } }) : null;
  if (!project) {
    const retired = code ? await db.retiredInviteCode.findUnique({ where: { code } }) : null;
    if (retired) throw new AppError(410, "INVITE_CODE_EXPIRED", "This invite code was replaced");
    throw new AppError(404, "INVITE_CODE_INVALID", "No project has this invite code");
  }
  if (project.status !== "ACTIVE") throw projectEnded();
  return project;
}

export async function joinPreview(db: Db, rawCode: string, userId: string): Promise<JoinPreview> {
  const found = await findProjectByCode(db, rawCode);
  const project = await db.project.findUniqueOrThrow({
    where: { id: found.id },
    include: {
      members: { orderBy: { joinedAt: "asc" }, include: { user: { select: { name: true } } } },
      packages: { select: { ownerId: true } },
    },
  });
  const active = project.members.filter(isActiveMember);
  const leader = active.find((m) => m.role === "LEADER");
  const alreadyMember = active.some((m) => m.userId === userId);
  return {
    projectId: project.id,
    name: project.name,
    shortCode: project.shortCode,
    courseName: project.courseName,
    groupLabel: project.groupLabel,
    color: project.color,
    leaderName: leader?.user.name ?? "",
    memberCount: active.length,
    teamSize: project.teamSize,
    freePackages: project.packages.filter((p) => p.ownerId === null).length,
    members: sortLeaderFirst(active).map((m) => ({ name: m.user.name, color: m.color })),
    alreadyMember,
    full: !alreadyMember && active.length >= MAX_ACTIVE_MEMBERS,
  };
}

/** Pending invites addressed to this user (by email or GitHub username, both stored lower-case). */
export function invitesFor(user: Pick<User, "email" | "githubUsername">): Prisma.InviteWhereInput[] {
  const or: Prisma.InviteWhereInput[] = [];
  if (user.email) or.push({ email: user.email.toLowerCase() });
  if (user.githubUsername) or.push({ githubUsername: user.githubUsername.toLowerCase() });
  return or;
}

/**
 * Adds the user to an ACTIVE project inside the caller's transaction (the project row is locked, so
 * colours stay unique and a double tap joins once). An active member just gets their membership back
 * (nothing else happens); someone who left rejoins; someone the leader removed can't come back; a 9th
 * active member gets TEAM_FULL. A real join counts as joining now (joinedAt), grows the planned team
 * size when needed, goes into the feed and reminds the leader when no package is left for them. Any
 * pending invites the user had for this project count as accepted.
 */
export async function joinProject(tx: Tx, projectId: string, user: User, now = new Date()): Promise<Member> {
  const project = await lockProject(tx, projectId);
  if (project.status !== "ACTIVE") throw projectEnded();

  let member = await tx.member.findUnique({ where: { projectId_userId: { projectId, userId: user.id } } });
  if (member?.removed) throw new AppError(403, "REMOVED_FROM_PROJECT", "The leader removed you from this project");
  if (member && isActiveMember(member)) {
    await acceptInvites(tx, projectId, user, now);
    return member;
  }

  const active = await tx.member.count({ where: { projectId, leftAt: null, removed: false } });
  if (active >= MAX_ACTIVE_MEMBERS) {
    throw new AppError(409, "TEAM_FULL", `This project already has ${MAX_ACTIVE_MEMBERS} people`);
  }
  if (!member) {
    member = await tx.member.create({
      data: { projectId, userId: user.id, role: "MEMBER", color: await pickMemberColor(tx, projectId), joinedAt: now },
    });
  } else {
    // Keep their old colour unless someone active took it meanwhile.
    const others = await tx.member.count({
      where: { projectId, leftAt: null, removed: false, color: member.color, id: { not: member.id } },
    });
    const color = others > 0 ? await pickMemberColor(tx, projectId, member.id) : member.color;
    member = await tx.member.update({
      where: { id: member.id },
      data: { leftAt: null, color, joinedAt: now, packageReminderAt: null },
    });
  }
  if (active + 1 > project.teamSize) {
    await tx.project.update({ where: { id: projectId }, data: { teamSize: active + 1 } });
  }

  await acceptInvites(tx, projectId, user, now);
  await recordEvent(tx, { projectId, actorId: member.id, type: "JOINED", payload: {}, now });
  await bumpPackages(tx, projectId);
  await remindPackageless(tx, projectId, { joinedMemberId: member.id, now });
  return member;
}

async function acceptInvites(tx: Tx, projectId: string, user: User, now: Date): Promise<void> {
  const addressed = invitesFor(user);
  if (addressed.length === 0) return;
  await tx.invite.updateMany({
    where: { projectId, status: "PENDING", OR: addressed },
    data: { status: "ACCEPTED", respondedAt: now },
  });
}

export async function joinByCode(db: Db, rawCode: string, user: User, now = new Date()): Promise<Member> {
  const project = await findProjectByCode(db, rawCode);
  return db.$transaction((tx) => joinProject(tx, project.id, user, now), TX_OPTIONS);
}
