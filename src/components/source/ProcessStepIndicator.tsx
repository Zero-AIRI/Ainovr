// ============================================
// 步骤进度指示器
// ============================================

'use client';

interface ProcessStepIndicatorProps {
  steps: { key: string; label: string }[];
  currentStep: number;       // 0-based, -1 = 未开始
  completedSteps: Set<number>;
  errorStep?: number;        // 出错的步骤
}

export function ProcessStepIndicator({ steps, currentStep, completedSteps, errorStep }: ProcessStepIndicatorProps) {
  return (
    <div className="flex items-center gap-1">
      {steps.map((step, i) => {
        const isCompleted = completedSteps.has(i);
        const isRunning = currentStep === i;
        const isError = errorStep === i;

        return (
          <div key={step.key} className="flex items-center gap-1">
            <div className="flex items-center gap-1.5">
              <div
                className={`
                  w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors
                  ${isCompleted ? 'bg-green-500 text-white' : ''}
                  ${isRunning ? 'bg-primary text-primary-foreground animate-pulse' : ''}
                  ${isError ? 'bg-red-500 text-white' : ''}
                  ${!isCompleted && !isRunning && !isError ? 'bg-muted text-muted-foreground' : ''}
                `}
              >
                {isCompleted ? '✓' : isError ? '✕' : i + 1}
              </div>
              <span className={`text-xs ${isRunning ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`w-6 h-px ${isCompleted ? 'bg-green-500' : 'bg-border'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
