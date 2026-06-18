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
      <div className="wizard-header">
        <h1>AgentSchool</h1>
        <p className="subtitle">Who says AI can't learn?</p>
      </div>

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

      <div className="wizard-footer">
        <button
          className="btn btn-secondary"
          onClick={() => {
            if (canGoBack) {
              goToStep(STEPS[stepIndex - 1].step);
            }
          }}
          disabled={!canGoBack}
        >
          ← Back
        </button>

        {stepIndex < STEPS.length - 1 && (
          <button
            className="btn btn-primary"
            onClick={() => {
              if (canGoForward) {
                goToStep(STEPS[stepIndex + 1].step);
              }
            }}
            disabled={!canGoForward}
          >
            Next →
          </button>
        )}
      </div>
    </div>
  );
}
