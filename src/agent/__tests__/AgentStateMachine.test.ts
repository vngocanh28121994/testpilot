import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentStateMachine,
  DEFAULT_AGENT_BUDGET,
  type AgentRunInput,
} from '../AgentTypes.js';

const baseInput: AgentRunInput = {
  source: { type: 'document', path: 'spec.pdf' },
  policy: {
    allowAiDiscovery: true,
    allowVision: true,
    allowHealing: true,
    allowSourcePatch: false,
    requireHumanApprovalForHealing: false,
  },
};

describe('AgentStateMachine — initial state', () => {
  it('starts in CREATED', () => {
    const m = new AgentStateMachine(baseInput);
    assert.equal(m.current.state, 'CREATED');
  });

  it('id is non-empty', () => {
    const m = new AgentStateMachine(baseInput);
    assert.ok(m.current.id.length > 0);
  });

  it('counters start at zero', () => {
    const m = new AgentStateMachine(baseInput);
    assert.equal(m.current.aiCallCount, 0);
    assert.equal(m.current.visionCallCount, 0);
    assert.equal(m.current.healingAttemptCount, 0);
    assert.equal(m.current.totalStepCount, 0);
  });
});

describe('AgentStateMachine — transitions', () => {
  it('CREATED → ANALYZING is valid', () => {
    const m = new AgentStateMachine(baseInput);
    m.transition('ANALYZING');
    assert.equal(m.current.state, 'ANALYZING');
  });

  it('CREATED → EXECUTING is invalid and throws', () => {
    const m = new AgentStateMachine(baseInput);
    assert.throws(() => m.transition('EXECUTING'), /Invalid transition/);
  });

  it('CREATED → FAILED is invalid and throws', () => {
    const m = new AgentStateMachine(baseInput);
    assert.throws(() => m.transition('FAILED'), /Invalid transition/);
  });

  it('transition from a terminal state throws', () => {
    const m = new AgentStateMachine(baseInput);
    m.transition('ANALYZING');
    m.transition('FAILED');
    assert.ok(m.isTerminal());
    assert.throws(() => m.transition('ANALYZING'), /terminal state/);
  });

  it('happy path: full linear flow without healing', () => {
    const m = new AgentStateMachine(baseInput);
    const path = [
      'ANALYZING',
      'TEST_DESIGN',
      'GENERATING_GHERKIN',
      'IMPLEMENTING',
      'VALIDATING',
      'READY_FOR_EXECUTION',
      'EXECUTING',
      'COLLECTING_EVIDENCE',
      'REPORTING',
      'COMPLETED',
    ] as const;
    for (const s of path) m.transition(s);
    assert.equal(m.current.state, 'COMPLETED');
    assert.ok(m.isTerminal());
  });

  it('healing path: diagnosis → healing → retrying → collecting → reporting', () => {
    const m = new AgentStateMachine(baseInput);
    m.transition('ANALYZING');
    m.transition('TEST_DESIGN');
    m.transition('GENERATING_GHERKIN');
    m.transition('IMPLEMENTING');
    m.transition('VALIDATING');
    m.transition('READY_FOR_EXECUTION');
    m.transition('EXECUTING');
    m.transition('COLLECTING_EVIDENCE');
    m.transition('DIAGNOSING');
    m.transition('HEALING');
    m.transition('RETRYING');
    m.transition('COLLECTING_EVIDENCE');
    m.transition('REPORTING');
    m.transition('COMPLETED');
    assert.equal(m.current.state, 'COMPLETED');
  });

  it('ANALYZING → NEEDS_HUMAN_APPROVAL is valid (ambiguity gate)', () => {
    const m = new AgentStateMachine(baseInput);
    m.transition('ANALYZING');
    m.transition('NEEDS_HUMAN_APPROVAL');
    assert.equal(m.current.state, 'NEEDS_HUMAN_APPROVAL');
    assert.ok(m.isTerminal());
  });

  it('READY_FOR_EXECUTION → CANCELLED is valid', () => {
    const m = new AgentStateMachine(baseInput);
    m.transition('ANALYZING');
    m.transition('TEST_DESIGN');
    m.transition('GENERATING_GHERKIN');
    m.transition('IMPLEMENTING');
    m.transition('VALIDATING');
    m.transition('READY_FOR_EXECUTION');
    m.transition('CANCELLED');
    assert.ok(m.isTerminal());
  });
});

describe('AgentStateMachine — events', () => {
  it('addEvent increments totalStepCount', () => {
    const m = new AgentStateMachine(baseInput);
    m.transition('ANALYZING');
    m.addEvent({ phase: 'analysis', actor: 'agent', action: 'extract-requirements', status: 'completed' });
    assert.equal(m.current.totalStepCount, 1);
    m.addEvent({ phase: 'analysis', actor: 'agent', action: 'identify-risks', status: 'completed' });
    assert.equal(m.current.totalStepCount, 2);
  });

  it('addEvent returns the stored event with id and runId', () => {
    const m = new AgentStateMachine(baseInput);
    m.transition('ANALYZING');
    const ev = m.addEvent({ phase: 'analysis', actor: 'agent', action: 'step', status: 'started' });
    assert.ok(ev.id.length > 0);
    assert.equal(ev.runId, m.current.id);
    assert.ok(ev.timestamp.length > 0);
  });

  it('events are stored in run.events', () => {
    const m = new AgentStateMachine(baseInput);
    m.transition('ANALYZING');
    m.addEvent({ phase: 'analysis', actor: 'agent', action: 'step-a', status: 'completed' });
    m.addEvent({ phase: 'analysis', actor: 'deterministic-engine', action: 'step-b', status: 'completed' });
    assert.equal(m.current.events.length, 2);
  });

  it('event with optional fields round-trips correctly', () => {
    const m = new AgentStateMachine(baseInput);
    m.transition('ANALYZING');
    const ev = m.addEvent({
      phase: 'discovery',
      actor: 'deterministic-engine',
      action: 'match-element',
      status: 'completed',
      confidence: 0.92,
      durationMs: 120,
      evidenceRefs: ['obs-1', 'obs-2'],
    });
    assert.equal(ev.confidence, 0.92);
    assert.equal(ev.durationMs, 120);
    assert.deepEqual(ev.evidenceRefs, ['obs-1', 'obs-2']);
  });
});

describe('AgentStateMachine — budget enforcement', () => {
  it('trackAiCall returns true within budget', () => {
    const m = new AgentStateMachine(baseInput, { ...DEFAULT_AGENT_BUDGET, maxAiCalls: 3 });
    assert.ok(m.trackAiCall());
    assert.ok(m.trackAiCall());
    assert.ok(m.trackAiCall());
  });

  it('trackAiCall returns false when budget exhausted', () => {
    const m = new AgentStateMachine(baseInput, { ...DEFAULT_AGENT_BUDGET, maxAiCalls: 2 });
    m.trackAiCall();
    m.trackAiCall();
    assert.ok(!m.trackAiCall(), 'third call must be blocked');
  });

  it('vision calls tracked separately', () => {
    const m = new AgentStateMachine(baseInput, { ...DEFAULT_AGENT_BUDGET, maxVisionCalls: 1 });
    assert.ok(m.trackAiCall(true), 'first vision call allowed');
    assert.ok(!m.trackAiCall(true), 'second vision call blocked');
    // Non-vision AI calls still allowed (maxAiCalls not reached)
    assert.ok(m.trackAiCall(false), 'non-vision still allowed');
  });

  it('trackHealingAttempt returns false at limit', () => {
    const m = new AgentStateMachine(baseInput, { ...DEFAULT_AGENT_BUDGET, maxHealingAttempts: 1 });
    assert.ok(m.trackHealingAttempt());
    assert.ok(!m.trackHealingAttempt());
  });

  it('isBudgetExceeded false at exactly the step limit', () => {
    const m = new AgentStateMachine(baseInput, { ...DEFAULT_AGENT_BUDGET, maxTotalSteps: 2 });
    m.transition('ANALYZING');
    m.addEvent({ phase: 'analysis', actor: 'agent', action: 'a', status: 'completed' });
    m.addEvent({ phase: 'analysis', actor: 'agent', action: 'b', status: 'completed' });
    assert.ok(!m.isBudgetExceeded(), 'at exactly the limit, not yet exceeded');
  });

  it('isBudgetExceeded true after exceeding step limit', () => {
    const m = new AgentStateMachine(baseInput, { ...DEFAULT_AGENT_BUDGET, maxTotalSteps: 2 });
    m.transition('ANALYZING');
    m.addEvent({ phase: 'analysis', actor: 'agent', action: 'a', status: 'completed' });
    m.addEvent({ phase: 'analysis', actor: 'agent', action: 'b', status: 'completed' });
    m.addEvent({ phase: 'analysis', actor: 'agent', action: 'c', status: 'completed' });
    assert.ok(m.isBudgetExceeded());
  });

  it('isBudgetExceeded true when AI call count overflows', () => {
    const m = new AgentStateMachine(baseInput, { ...DEFAULT_AGENT_BUDGET, maxAiCalls: 1 });
    // trackAiCall guards against exceeding, but force the count for this edge case
    m.trackAiCall(); // count = 1, at limit
    assert.ok(!m.isBudgetExceeded(), 'at limit');
    // Simulate going over (would not happen via trackAiCall but validates isBudgetExceeded)
    (m.current as { aiCallCount: number }).aiCallCount = 2;
    assert.ok(m.isBudgetExceeded());
  });
});

describe('AgentStateMachine — updatedAt', () => {
  it('updatedAt advances on each transition', async () => {
    const m = new AgentStateMachine(baseInput);
    const t0 = m.current.updatedAt;
    await new Promise((r) => setTimeout(r, 2));
    m.transition('ANALYZING');
    assert.ok(m.current.updatedAt > t0, 'updatedAt should advance');
  });
});
