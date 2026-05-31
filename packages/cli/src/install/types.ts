import type { Lang } from "../i18n/install";

export type Section = "preflight" | "install" | "verify";

export interface StepResult {
  ok: boolean;
  detail?: string;
  errorReason?: string;
  errorSeeAlso?: string;
}

export interface Step {
  section: Section;
  labelKey: string;
  /** Quando false, o step é tratado como verify (status labels). Quando true, action (✓/✗). */
  isAction: boolean;
  run: () => Promise<StepResult>;
}

export type StepUiStatus = "pending" | "running" | "ok" | "error";

export interface StepState {
  step: Step;
  status: StepUiStatus;
  result?: StepResult;
  durationMs?: number;
}

export interface InstallReport {
  steps: StepState[];
  errors: StepState[];
  succeeded: boolean;
}

export interface RenderEnv {
  tty: boolean;
  color: boolean;
  lang: Lang;
  termWidth: number;
}
