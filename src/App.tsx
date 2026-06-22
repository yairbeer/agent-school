import { useEffect, useState } from "react";
import type { HealthResponse } from "../shared/api.js";
import type { SessionSummary, ConversationReview, AggregatedInsights, AgentType } from "../shared/types.js";
import { Wizard, type Step } from "./components/Wizard.js";
import { ProjectPicker } from "./components/ProjectPicker.js";
import { PreviewStep } from "./components/PreviewStep.js";
import { ReviewStep } from "./components/ReviewStep.js";
import { AggregateStep } from "./components/AggregateStep.js";
import { EditStep } from "./components/EditStep.js";
import "./App.css";

export default function App() {
  const [isHealthy, setIsHealthy] = useState<boolean | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<Step>("pick");
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentType>("pi");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const [reviews, setReviews] = useState<ConversationReview[]>([]);
  const [insights, setInsights] = useState<AggregatedInsights | null>(null);
  // Exclude thinking blocks from the preview AND from what is sent to the LLM
  // for analysis. On by default.
  const [excludeThinking, setExcludeThinking] = useState(true);

  useEffect(() => {
    // Test backend connection on mount
    fetch("/api/health")
      .then((res) => res.json() as Promise<HealthResponse>)
      .then((data) => {
        setIsHealthy(data.ok);
        setHealthError(null);
      })
      .catch((err) => {
        setIsHealthy(false);
        setHealthError(err instanceof Error ? err.message : "Unknown error");
      });
  }, []);

  const handleProjectSelected = (dir: string, selectedAgent: AgentType, sessionList: SessionSummary[]) => {
    setProjectDir(dir);
    setAgent(selectedAgent);
    setSessions(sessionList);
    setSelectedSessions(new Set());
    setReviews([]);
    setInsights(null);
    setCurrentStep("preview");
  };

  const handleStepChange = (step: Step) => {
    if (step === "pick") {
      // Resetting wizard
      setProjectDir(null);
      setAgent("pi");
      setSessions([]);
      setSelectedSessions(new Set());
      setReviews([]);
      setInsights(null);
    }
    setCurrentStep(step);
  };

  if (isHealthy === false) {
    return (
      <div className="app app-error">
        <div className="error-container">
          <h1>Backend Connection Failed</h1>
          <p>
            Could not connect to the backend server. Make sure it's running on port 3001:
          </p>
          <code>npm run dev:backend</code>
          <p className="error-details">{healthError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Wizard currentStep={currentStep} onStepChange={handleStepChange}>
        {currentStep === "pick" && (
          <ProjectPicker onProjectSelected={handleProjectSelected} isLoading={isHealthy === null} />
        )}

        {currentStep === "preview" && sessions.length > 0 && (
          <PreviewStep
            projectDir={projectDir || ""}
            agent={agent}
            sessions={sessions}
            onSelectChange={setSelectedSessions}
            excludeThinking={excludeThinking}
            onExcludeThinkingChange={setExcludeThinking}
          />
        )}

        {currentStep === "review" && projectDir && sessions.length > 0 && (
          <ReviewStep
            sessions={sessions.filter((s) => selectedSessions.has(s.id))}
            projectDir={projectDir}
            agent={agent}
            excludeThinking={excludeThinking}
            onReviewsComplete={(newReviews) => {
              setReviews(newReviews);
            }}
          />
        )}

        {currentStep === "aggregate" && reviews.length > 0 && (
          <AggregateStep reviews={reviews} onInsightsReady={setInsights} />
        )}

        {currentStep === "edit" && projectDir && (
          <EditStep
            projectDir={projectDir}
            agent={agent}
            reviews={reviews}
            insights={insights}
          />
        )}
      </Wizard>

      {isHealthy === null && (
        <div className="connection-check">
          <p className="loading">Connecting to backend...</p>
        </div>
      )}
    </div>
  );
}
