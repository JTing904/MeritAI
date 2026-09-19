import type { MemberView, PackageView, ProjectView } from '@shared/types';
import type { Messages } from '@/i18n/zh';
import type { RelativeLabels } from '@/lib/time';

const DAY_MS = 24 * 60 * 60 * 1000;

export const activeMembers = (project: ProjectView) => project.members.filter((m) => m.active);

/** 「5 / 6 人」 while fewer people are in than planned, else 「6 人」. */
export function peopleLabel(project: ProjectView, t: Messages): string {
  return t.members.people(activeMembers(project).length, project.basics.teamSize);
}

export const memberPackage = (project: ProjectView, member: MemberView): PackageView | null =>
  member.packageId ? (project.packages.find((p) => p.id === member.packageId) ?? null) : null;

/** Joined less than a day ago (「刚加入」). */
export const joinedRecently = (member: MemberView, now = Date.now()) => now - Date.parse(member.joinedAt) < DAY_MS;

/** 「9月18日」 / 「2025年9月18日」 in the viewer's time zone. */
export function dayLabel(iso: string, labels: RelativeLabels, now = new Date()): string {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear()
    ? labels.thisYear(d.getMonth() + 1, d.getDate())
    : labels.older(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
