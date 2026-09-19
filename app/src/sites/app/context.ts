import type { Session } from "@/lib/data";

export interface TimerState {
  running: boolean;
  startedAt: number;
  accrued: number;
  description: string;
  caseId: string | null;
}

export interface AppShellContext {
  session: Session | null;
  timer: TimerState;
  setTimer: (t: TimerState) => void;
}
