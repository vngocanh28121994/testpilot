import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { waitFor, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { ROUTES } from '@/api/routes';
import { ScenarioEditor } from '../ScenarioEditor';
import type { FeatureSummary, NormalizeResponse } from '@core/ui/contracts.js';

const feature: FeatureSummary = {
  name: 'dang-nhap.feature',
  revision: 'r1',
  feature: 'Đăng nhập',
  content: 'Feature: Đăng nhập\n\n  Scenario: Đăng nhập\n    Given I open the app\n',
  background: [],
  scenarios: [{ name: 'Đăng nhập', tags: [], platforms: ['web'], steps: 1, stepTexts: [], review: null }],
  coverage: null,
  error: null,
};

function normalized(valid: boolean): NormalizeResponse {
  return {
    content: '  Scenario: Đăng nhập\n    Given I open the app',
    changes: [],
    unresolved: [],
    valid,
    usedAi: false,
    discoveredLater: [],
    actionProposals: valid ? [] : [{
      id: 'action-1', label: 'Đăng nhập bằng OTP', kind: 'macro', status: 'proposed',
      phraseTemplate: 'I log in with {{otp}}', parameters: [{ name: 'otp', example: '123456' }],
      expansion: ['I fill "OTP" with "{{otp}}"'], postcondition: '"Trang chủ" is visible',
      sourceExample: 'I log in with 123456', createdAt: '2026-08-28T00:00:00.000Z',
    }],
    appliedActions: [],
    actionAnalysis: { available: true, attempted: true },
    scenarioPlan: { source: 'deterministic', goal: 'Đăng nhập', preconditions: [], reusableFlows: [], steps: [], warnings: [] },
  };
}

describe('ScenarioEditor — normalize và action proposal', () => {
  it('khoá Lưu cho tới khi action đề xuất được duyệt và chuẩn hoá lại hợp lệ', async () => {
    const user = userEvent.setup();
    let normalizeCalls = 0;
    server.use(
      http.post(ROUTES.featureNormalize, () => {
        normalizeCalls += 1;
        return HttpResponse.json(normalized(normalizeCalls > 1));
      }),
      http.post(ROUTES.actionsReview, () => HttpResponse.json({ action: {}, actions: [] })),
    );
    renderWithProviders(
      <ScenarioEditor mode="edit" target={{ feature, scenarioName: 'Đăng nhập' }} features={[feature]} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Chuẩn hoá' }));
    await screen.findByText('Đăng nhập bằng OTP');
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Duyệt action' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeEnabled());
    expect(normalizeCalls).toBe(2);
  });
});
