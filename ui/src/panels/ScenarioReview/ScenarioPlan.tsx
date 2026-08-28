import { AlertTriangle, BrainCircuit } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ScenarioPlan as ScenarioPlanView } from '@core/ui/contracts.js';

const labels = {
  precondition: 'Điều kiện',
  navigation: 'Điều hướng',
  focusRegion: 'Vùng kiểm tra',
  action: 'Thao tác',
  assertion: 'Kết quả mong đợi',
} as const;

export function ScenarioPlan({ plan }: { plan: ScenarioPlanView }) {
  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BrainCircuit className="text-primary size-4" /> AI hiểu kịch bản
          <Badge variant="outline" className="ms-auto font-normal">
            {plan.source === 'ai' ? 'AI phân tích' : 'Phân tích cục bộ'}
          </Badge>
        </CardTitle>
        <p className="text-sm font-medium">Mục tiêu: {plan.goal || 'Kịch bản hiện tại'}</p>
        {plan.screen && <p className="text-muted-foreground text-xs">Màn hình: {plan.screen}</p>}
      </CardHeader>
      <CardContent className="space-y-3">
        {(plan.preconditions.length > 0 || plan.reusableFlows.length > 0) && (
          <p className="text-muted-foreground text-xs">
            {[...plan.preconditions, ...plan.reusableFlows].join(' · ')}
          </p>
        )}
        <ol className="space-y-2">
          {plan.steps.map((step) => (
            <li key={`${step.line}-${step.kind}`} className="flex gap-2 text-sm">
              <Badge variant="secondary" className="h-fit shrink-0 text-xs">{labels[step.kind]}</Badge>
              <div>
                <p>{step.target || step.action || `Dòng ${step.line}`}</p>
                {(step.scope || step.expectedResult) && (
                  <p className="text-muted-foreground text-xs">{[step.scope, step.expectedResult].filter(Boolean).join(' · ')}</p>
                )}
                {step.confidence < 0.8 && (
                  <p className="text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1 text-xs">
                    <AlertTriangle className="size-3" /> Cần người dùng kiểm tra lại cách hiểu này
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
        {plan.warnings.map((warning) => (
          <p key={warning} className="text-amber-700 dark:text-amber-400 text-xs">{warning}</p>
        ))}
      </CardContent>
    </Card>
  );
}
