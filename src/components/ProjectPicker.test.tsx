import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectPicker } from "./ProjectPicker";
import * as apiClient from "../api/client.js";

// Mock the API client
vi.mock("../api/client.js", () => ({
  SessionApiClient: {
    listSessions: vi.fn(),
  },
  browseDirectory: vi.fn(),
}));

describe("ProjectPicker", () => {
  const mockOnProjectSelected = vi.fn();

  beforeEach(() => {
    mockOnProjectSelected.mockClear();
    vi.clearAllMocks();
  });

  it("renders the form elements correctly", () => {
    render(<ProjectPicker onProjectSelected={mockOnProjectSelected} />);

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Search for Sessions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Browse/i })).toBeInTheDocument();
  });

  it("has disabled submit button when input is empty", () => {
    render(<ProjectPicker onProjectSelected={mockOnProjectSelected} />);

    const button = screen.getByText(/Search for Sessions/i);
    expect(button).toBeDisabled();
  });

  it("enables submit button when input has value", () => {
    render(<ProjectPicker onProjectSelected={mockOnProjectSelected} />);

    const input = screen.getByDisplayValue("") as HTMLInputElement;
    const button = screen.getByText(/Search for Sessions/i);

    fireEvent.change(input, { target: { value: "/some/path" } });
    expect(button).not.toBeDisabled();
  });

  it("shows privacy banner with warning", () => {
    render(<ProjectPicker onProjectSelected={mockOnProjectSelected} />);

    expect(screen.getByText(/⚠️ Privacy Notice/i)).toBeInTheDocument();
    expect(screen.getByText(/Sessions may contain sensitive information/i)).toBeInTheDocument();
  });

  it("uses generic path example in placeholder (not personal paths)", () => {
    render(<ProjectPicker onProjectSelected={mockOnProjectSelected} />);

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.placeholder).toContain("/path/to/your/project");
    expect(input.placeholder).toContain("--path-to-your-project--");
    expect(input.placeholder).not.toContain("/Users/alice");
    expect(input.placeholder).not.toContain("--Users-alice");
  });

  it("renders Browse button", () => {
    render(<ProjectPicker onProjectSelected={mockOnProjectSelected} />);

    const browseButton = screen.getByRole("button", { name: /Browse/i });
    expect(browseButton).toBeInTheDocument();
    expect(browseButton).not.toBeDisabled();
  });

  it("opens modal when Browse button is clicked", async () => {
    const mockBrowseDirectory = vi.mocked(apiClient.browseDirectory);
    mockBrowseDirectory.mockResolvedValue({
      path: "/home/user",
      parent: "/home",
      entries: [
        { name: "projects", path: "/home/user/projects" },
        { name: "documents", path: "/home/user/documents" },
      ],
    });

    render(<ProjectPicker onProjectSelected={mockOnProjectSelected} />);

    const browseButton = screen.getByRole("button", { name: /Browse/i });
    fireEvent.click(browseButton);

    await waitFor(() => {
      expect(screen.getByText(/Browse for Project Directory/i)).toBeInTheDocument();
    });
  });

  it("lists directories when browsing", async () => {
    const mockBrowseDirectory = vi.mocked(apiClient.browseDirectory);
    mockBrowseDirectory.mockResolvedValue({
      path: "/home/user",
      parent: "/home",
      entries: [
        { name: "projects", path: "/home/user/projects" },
        { name: "documents", path: "/home/user/documents" },
      ],
    });

    render(<ProjectPicker onProjectSelected={mockOnProjectSelected} />);

    const browseButton = screen.getByRole("button", { name: /Browse/i });
    fireEvent.click(browseButton);

    await waitFor(() => {
      expect(screen.getByText(/📁 projects/)).toBeInTheDocument();
      expect(screen.getByText(/📁 documents/)).toBeInTheDocument();
    });
  });

  it("fills input when directory is selected from browser", async () => {
    const mockBrowseDirectory = vi.mocked(apiClient.browseDirectory);
    mockBrowseDirectory.mockResolvedValue({
      path: "/home/user",
      parent: "/home",
      entries: [
        { name: "projects", path: "/home/user/projects" },
      ],
    });

    render(<ProjectPicker onProjectSelected={mockOnProjectSelected} />);

    const browseButton = screen.getByRole("button", { name: /Browse/i });
    fireEvent.click(browseButton);

    await waitFor(() => {
      expect(screen.getByText(/Browse for Project Directory/i)).toBeInTheDocument();
    });

    const useThisFolderButton = screen.getByRole("button", { name: /Use This Folder/i });
    fireEvent.click(useThisFolderButton);

    await waitFor(() => {
      const input = screen.getByRole("textbox") as HTMLInputElement;
      expect(input.value).toBe("/home/user");
    });
  });
});
