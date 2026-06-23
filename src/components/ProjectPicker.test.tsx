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
    expect(screen.getByRole("button", { name: /Browse/i })).toBeInTheDocument();
  });

  it("shows privacy banner with warning", () => {
    render(<ProjectPicker onProjectSelected={mockOnProjectSelected} />);

    expect(screen.getByText(/⚠️ Privacy Notice/i)).toBeInTheDocument();
    expect(screen.getByText(/Sessions may contain sensitive information/i)).toBeInTheDocument();
  });

  it("leaves the directory placeholder empty (users browse for a path)", () => {
    render(<ProjectPicker onProjectSelected={mockOnProjectSelected} />);

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.placeholder).toBe("");
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

  it("fills input and searches when a directory is selected from browser", async () => {
    const mockBrowseDirectory = vi.mocked(apiClient.browseDirectory);
    mockBrowseDirectory.mockResolvedValue({
      path: "/home/user",
      parent: "/home",
      entries: [
        { name: "projects", path: "/home/user/projects" },
      ],
    });
    const mockListSessions = vi.mocked(apiClient.SessionApiClient.listSessions);
    mockListSessions.mockResolvedValue({ sessions: [], error: null });

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
    expect(mockListSessions).toHaveBeenCalledWith("/home/user", "pi");
  });
});
