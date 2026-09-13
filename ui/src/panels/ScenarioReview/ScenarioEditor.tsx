import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScenarioEditorFields, type CreateTarget } from './ScenarioEditorFields';

export type { CreateTarget } from './ScenarioEditorFields';

/** Panel sửa đầy đủ; toàn bộ logic soạn thảo dùng chung với editor inline. */
export function ScenarioEditor({
  open,
  title,
  filename,
  block,
  tagSuggestions,
  saving,
  featureNames,
  target,
  onTargetChange,
  onSave,
  onClose,
}: {
  open: boolean;
  title: string;
  filename: string;
  block: string;
  tagSuggestions: string[];
  saving: boolean;
  featureNames?: string[];
  target?: CreateTarget;
  onTargetChange?: (target: CreateTarget) => void;
  onSave: (block: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{filename}</SheetDescription>
        </SheetHeader>
        <ScenarioEditorFields
          block={block}
          tagSuggestions={tagSuggestions}
          saving={saving}
          featureNames={featureNames}
          target={target}
          onTargetChange={onTargetChange}
          onSave={onSave}
          onClose={onClose}
        />
      </SheetContent>
    </Sheet>
  );
}
