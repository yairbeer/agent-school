import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Wizard } from "./Wizard";

describe("Wizard", () => {
  const mockOnStepChange = vi.fn();

  beforeEach(() => {
    mockOnStepChange.mockClear();
    vi.clearAllMocks();
  });

  it("renders all wizard steps", () => {
    render(
      <Wizard currentStep="pick" onStepChange={mockOnStepChange}>
        <div>Test content</div>
      </Wizard>
    );

    expect(screen.getByText("Pick Project")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Propose & Save")).toBeInTheDocument();
  });

  it("renders the content passed as children", () => {
    render(
      <Wizard currentStep="pick" onStepChange={mockOnStepChange}>
        <div>Test content</div>
      </Wizard>
    );

    expect(screen.getByText("Test content")).toBeInTheDocument();
  });

  it("highlights the current step", () => {
    render(
      <Wizard currentStep="preview" onStepChange={mockOnStepChange}>
        <div>Test content</div>
      </Wizard>
    );

    const previewStep = screen.getByText("Preview").closest("button");
    expect(previewStep).toHaveClass("active");
  });

  it("disables forward steps when on first step", () => {
    render(
      <Wizard currentStep="pick" onStepChange={mockOnStepChange}>
        <div>Test content</div>
      </Wizard>
    );

    const aggregateButton = screen.getByText("Propose & Save").closest("button");
    expect(aggregateButton).toBeDisabled();
  });

  it("enables back button when not on first step", () => {
    render(
      <Wizard currentStep="review" onStepChange={mockOnStepChange}>
        <div>Test content</div>
      </Wizard>
    );

    const backButton = screen.getByText("← Back");
    expect(backButton).not.toBeDisabled();
  });

  it("disables back button on first step", () => {
    render(
      <Wizard currentStep="pick" onStepChange={mockOnStepChange}>
        <div>Test content</div>
      </Wizard>
    );

    const backButton = screen.getByText("← Back");
    expect(backButton).toBeDisabled();
  });

  it("shows next button on all steps except last", () => {
    const { rerender } = render(
      <Wizard currentStep="pick" onStepChange={mockOnStepChange}>
        <div>Test content</div>
      </Wizard>
    );

    expect(screen.getByText("Next →")).toBeInTheDocument();

    rerender(
      <Wizard currentStep="edit" onStepChange={mockOnStepChange}>
        <div>Test content</div>
      </Wizard>
    );

    expect(screen.queryByText("Next →")).not.toBeInTheDocument();
  });

  it("displays wizard header", () => {
    render(
      <Wizard currentStep="pick" onStepChange={mockOnStepChange}>
        <div>Test content</div>
      </Wizard>
    );

    expect(screen.getByText("AgentSchool")).toBeInTheDocument();
    expect(screen.getByText("Who says AI can't learn?")).toBeInTheDocument();
  });
});
