import type { gradeZh } from './grade.zh';

const items = (n: number) => (n === 1 ? '1 item' : `${n} items`);

export const gradeEn: typeof gradeZh = {
  title: (title) => `Grade: ${title}`,
  line: (name, when, n, due) => `${name} · handed in ${when} · ${items(n)} · due ${due}`,
  late: 'Late',
  level: 'Grade',
  full: (pts) => `Full ${pts} pts`,
  half: (pts) => `Half · ${pts} pts`,
  fail: '0 pts, must resubmit',
  reason: 'Reason',
  reasonSmall: '· required for "Half" or "Fail"',
  reasonPlaceholder: "Against the brief: what's missing or not done",
  submit: 'Confirm grade',
  done: (name) => `Graded. ${name} will be notified`,
  doneQuiet: 'Graded',
  hint: (name) => `Everyone in the group can see the reason; ${name} will be notified.`,
  hintQuiet: 'Everyone in the group can see the reason.',

  outside: {
    line: (name, due) => `${name} · due ${due}`,
    empty: (n, max) => `They haven't handed in evidence in the app · ${n} / ${max}`,
    toggle: 'They gave me the evidence outside the app (I complete it for them)',
    toggleSmall:
      'Turn this on when they gave you the evidence privately (WhatsApp, etc.). The task is marked done, the task page says "Completed by the leader · evidence handed in outside the app", they are notified, and the points count.',
    note: 'Note',
    noteSmall: '· optional, everyone can see it',
    submit: 'Mark done and grade',
    done: (name) => `Marked done. ${name} will be notified`,
    doneQuiet: 'Marked done',
    hint: (name) => `Everyone in the group can see the note and the grade; ${name} will be notified.`,
    hintQuiet: 'Everyone in the group can see the note and the grade.',
  },

  override: {
    title: (title) => `Override grade: ${title}`,
    now: (grade, gain, no) => `Now: ${grade} · ${gain}${no ? ` · attempt ${no}` : ''}`,
    gainFull: (pts) => `full ${pts} pts`,
    gainHalf: (pts) => `${pts} pts`,
    gainFail: '0 pts',
    by: (who, date, from, to) => `${who === null ? 'You' : who} changed it from ${from} to ${to} on ${date}`,
    undo: 'Undo last override',
    undone: (grade) => `Override undone, back to ${grade}`,
    to: 'Change to',
    current: "It's this now",
    reason: 'Reason',
    reasonSmall: '· required',
    hint: (name, earned) =>
      `Any of the four grades, lower ones too. After the override everyone can see your reason${
        name ? `, ${name} will be notified` : ''
      }${earned ? `, and the points become ${earned}` : ''}; you can undo it if it was a mistake. You'll be asked to confirm first.`,
    submit: 'Confirm override',
    confirmTitle: (to) => `Change it to ${to}?`,
    confirmBody: (name) => `${name} will be notified, and everyone can see your reason.`,
    confirmBodyQuiet: 'Everyone in the group can see your reason.',
    confirm: 'Override',
    done: (name, earned) => `Overridden. ${name} gets ${earned} pts`,
    doneYou: (earned) => `Overridden. You get ${earned} pts`,
    doneQuiet: 'Overridden',
  },
};
