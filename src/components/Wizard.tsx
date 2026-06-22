/**
 * Wizard component managing the 6-step flow
 */

import { ReactNode } from "react";
import { Step, STEPS } from "../types/wizard.js";

interface WizardProps {
  children: ReactNode;
  currentStep: Step;
  onStepChange: (step: Step) => void;
}

export function Wizard({ children, currentStep, onStepChange }: WizardProps) {
  const stepIndex = STEPS.findIndex((s) => s.step === currentStep);

  const canGoBack = stepIndex > 0;
  const canGoForward = stepIndex < STEPS.length - 1;

  const goToStep = (step: Step) => {
    const targetIndex = STEPS.findIndex((s) => s.step === step);
    // Allow forward and back navigation freely
    if (targetIndex >= 0) {
      onStepChange(step);
    }
  };

  return (
    <div className="wizard">
      <header className="wizard-header">
        <div className="wizard-title">
          <h1>AgentSchool</h1>
          <span className="subtitle">Who says AI can't learn?</span>
        </div>

        <div className="wizard-nav">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (canGoBack) {
                goToStep(STEPS[stepIndex - 1].step);
              }
            }}
            disabled={!canGoBack}
          >
            ← Back
          </button>

          {canGoForward && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => goToStep(STEPS[stepIndex + 1].step)}
            >
              Next →
            </button>
          )}
        </div>
      </header>

      <nav className="wizard-steps">
        {STEPS.map((s, idx) => (
          <button
            key={s.step}
            className={`step ${s.step === currentStep ? "active" : ""} ${
              idx <= stepIndex ? "completed" : "pending"
            }`}
            onClick={() => goToStep(s.step)}
            disabled={idx > stepIndex}
            title={s.description}
          >
            <span className="step-number">{idx + 1}</span>
            <span className="step-label">{s.label}</span>
          </button>
        ))}
      </nav>

      <div className="wizard-content">{children}</div>
    </div>
  );
}
