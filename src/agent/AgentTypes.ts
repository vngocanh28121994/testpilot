/**
 * Agent orchestration — state machine, events, and budget.
 *
 * The orchestrator is a state machine, not a long try/catch chain. Every
 * transition is validated. Budget limits prevent infinite AI loops.
 * All state changes are persisted as AgentEvents for audit and UI rendering.
 */

export type AgentPhase =
  | 'analysis'
  | 'test-design'
  | 'gherkin'
  | 'implementation'
  | 'discovery'
  | 'execution'
  | 'diagnosis'
  | 'healing'
  | 'reporting';

export type AgentActor =
  | 'agent'
  | 'deterministic-engine'
  | 'appium'
  | 'aws'
  | 'human';

export type AgentEventStatus =
  | 'started'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'blocked';

export interface AgentEvent {
  id: string;
  runId: string;
  timestamp: string;
  phase: AgentPhase;
  actor: AgentActor;
  action: string;
  status: AgentEventStatus;
  inputRef?: string;
  outputRef?: string;
  confidence?: number;
  durationMs?: number;
  evidenceRefs?: string[];
  error?: { code: string; message: string };
}

export type AgentRunState =
  | 'CREATED'
  | 'ANALYZING'
  | 'TEST_DESIGN'
  | 'GENERATING_GHERKIN'
  | 'IMPLEMENTING'
  | 'VALIDATING'
  | 'READY_FOR_EXECUTION'
  | 'EXECUTING'
  | 'COLLECTING_EVIDENCE'
  | 'DIAGNOSING'
  | 'HEALING'
  | 'RETRYING'
  | 'REPORTING'
  | 'COMPLETED'
  | 'BLOCKED'
  | 'CANCELLED'
  | 'NEEDS_HUMAN_APPROVAL'
  | 'FAILED';

const TERMINAL_STATES = new Set<AgentRunState>([
  'COMPLETED',
  'BLOCKED',
  'CANCELLED',
  'NEEDS_HUMAN_APPROVAL',
  'FAILED',
]);

/**
 * Allowed forward transitions. States not listed here are terminal.
 * RETRYING → COLLECTING_EVIDENCE creates a controlled cycle — budget
 * enforcement (not the graph) prevents infinite loops.
 */
const VALID_TRANSITIONS: Partial<Record<AgentRunState, AgentRunState[]>> = {
  CREATED: ['ANALYZING'],
  ANALYZING: ['TEST_DESIGN', 'NEEDS_HUMAN_APPROVAL', 'FAILED'],
  TEST_DESIGN: ['GENERATING_GHERKIN', 'NEEDS_HUMAN_APPROVAL', 'FAILED'],
  GENERATING_GHERKIN: ['IMPLEMENTING', 'FAILED'],
  IMPLEMENTING: ['VALIDATING', 'FAILED'],
  VALIDATING: ['READY_FOR_EXECUTION', 'FAILED'],
  READY_FOR_EXECUTION: ['EXECUTING', 'CANCELLED'],
  EXECUTING: ['COLLECTING_EVIDENCE', 'FAILED'],
  COLLECTING_EVIDENCE: ['DIAGNOSING', 'REPORTING'],
  DIAGNOSING: ['HEALING', 'REPORTING', 'FAILED'],
  HEALING: ['RETRYING', 'REPORTING'],
  RETRYING: ['COLLECTING_EVIDENCE', 'REPORTING'],
  REPORTING: ['COMPLETED'],
};

export interface AgentBudget {
  maxTotalSteps: number;
  maxAiCalls: number;
  maxVisionCalls: number;
  maxHealingAttempts: number;
  maxRetriesPerTest: number;
  maxExecutionMinutes: number;
  maxEstimatedAiCost?: number;
}

export const DEFAULT_AGENT_BUDGET: AgentBudget = {
  maxTotalSteps: 200,
  maxAiCalls: 20,
  maxVisionCalls: 5,
  maxHealingAttempts: 1,
  maxRetriesPerTest: 1,
  maxExecutionMinutes: 60,
};

export interface AgentRunInput {
  source: {
    type: 'document' | 'url' | 'text' | 'existing-test';
    path?: string;
    content?: string;
  };
  target?: {
    platform?: 'android' | 'ios' | 'web';
    environment?: string;
    appPath?: string;
  };
  execution?: {
    mode: 'local' | 'aws' | 'hybrid';
    deviceIds?: string[];
  };
  policy?: {
    allowAiDiscovery: boolean;
    allowVision: boolean;
    allowHealing: boolean;
    allowSourcePatch: boolean;
    requireHumanApprovalForHealing: boolean;
  };
}

export interface AgentRun {
  id: string;
  state: AgentRunState;
  input: AgentRunInput;
  budget: AgentBudget;
  events: AgentEvent[];
  createdAt: string;
  updatedAt: string;
  aiCallCount: number;
  visionCallCount: number;
  healingAttemptCount: number;
  totalStepCount: number;
}

export class AgentStateMachine {
  private run: AgentRun;

  constructor(input: AgentRunInput, budget: AgentBudget = DEFAULT_AGENT_BUDGET) {
    const now = new Date().toISOString();
    this.run = {
      id: `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      state: 'CREATED',
      input,
      budget,
      events: [],
      createdAt: now,
      updatedAt: now,
      aiCallCount: 0,
      visionCallCount: 0,
      healingAttemptCount: 0,
      totalStepCount: 0,
    };
  }

  get current(): Readonly<AgentRun> {
    return this.run;
  }

  transition(nextState: AgentRunState): void {
    if (TERMINAL_STATES.has(this.run.state)) {
      throw new Error(
        `Cannot transition from terminal state "${this.run.state}" to "${nextState}"`,
      );
    }
    const allowed = VALID_TRANSITIONS[this.run.state] ?? [];
    if (!allowed.includes(nextState)) {
      throw new Error(
        `Invalid transition from "${this.run.state}" to "${nextState}". ` +
          `Allowed: ${allowed.length > 0 ? allowed.join(', ') : '(none — terminal)'}`,
      );
    }
    this.run.state = nextState;
    this.run.updatedAt = new Date().toISOString();
  }

  addEvent(event: Omit<AgentEvent, 'id' | 'runId' | 'timestamp'>): AgentEvent {
    const full: AgentEvent = {
      ...event,
      id: `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      runId: this.run.id,
      timestamp: new Date().toISOString(),
    };
    this.run.events.push(full);
    this.run.totalStepCount += 1;
    this.run.updatedAt = full.timestamp;
    return full;
  }

  /**
   * Reserve an AI call against the budget.
   * Returns false when the budget is exhausted — caller must stop and report.
   */
  trackAiCall(vision = false): boolean {
    if (this.run.aiCallCount >= this.run.budget.maxAiCalls) return false;
    if (vision && this.run.visionCallCount >= this.run.budget.maxVisionCalls) return false;
    this.run.aiCallCount += 1;
    if (vision) this.run.visionCallCount += 1;
    return true;
  }

  /**
   * Reserve a healing attempt against the budget.
   * Returns false when the max healing attempts have been reached.
   */
  trackHealingAttempt(): boolean {
    if (this.run.healingAttemptCount >= this.run.budget.maxHealingAttempts) return false;
    this.run.healingAttemptCount += 1;
    return true;
  }

  /**
   * True when the run has consumed more steps or AI calls than the budget allows.
   * The orchestrator must stop autonomous actions and transition to REPORTING or BLOCKED.
   */
  isBudgetExceeded(): boolean {
    return (
      this.run.totalStepCount > this.run.budget.maxTotalSteps ||
      this.run.aiCallCount > this.run.budget.maxAiCalls
    );
  }

  isTerminal(): boolean {
    return TERMINAL_STATES.has(this.run.state);
  }
}
