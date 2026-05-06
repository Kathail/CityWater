import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProcedureRunner } from "./ProcedureRunner";
import type { TaskDefinitionRead } from "./api";

const baseTask = {
  id: 1,
  code: "TEST",
  version: 1,
  status: "active" as const,
  title: "Test task",
  summary: null,
  produces: "work_order" as const,
  default_category: null,
  default_priority: null,
  default_domain: null,
  applies_to_classes: [],
  triggers: [],
  prefill: {},
  form: [],
  canned_comments: [],
  smart_comments: [],
  completion: {},
  spawns: [],
  clocks: [],
  lang: "en",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  procedure: {
    steps: [
      { n: 1, title: "Step one", auto_complete_when: "flush_completed == true" },
      { n: 2, title: "Step two", auto_complete_when: "data_recorded == true" },
      { n: 3, title: "Step three with no rule" },
    ],
  },
} satisfies TaskDefinitionRead;

describe("ProcedureRunner — clickability", () => {
  it("clicks toggle a step that has an auto rule (manual override wins)", () => {
    const onChange = vi.fn();
    render(
      <ProcedureRunner task={baseTask} taskData={{}} onChange={onChange} />,
    );
    // Step one: button by accessible name (matches the title)
    const stepOne = screen.getByRole("button", { name: /Step one/ });
    expect(stepOne).not.toBeDisabled();
    fireEvent.click(stepOne);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ _steps: { 1: true } });
  });

  it("clicks toggle a step that has no auto rule", () => {
    const onChange = vi.fn();
    render(
      <ProcedureRunner task={baseTask} taskData={{}} onChange={onChange} />,
    );
    const stepThree = screen.getByRole("button", { name: /Step three/ });
    fireEvent.click(stepThree);
    expect(onChange).toHaveBeenCalledWith({ _steps: { 3: true } });
  });

  it("un-ticks an auto-checked step on first click", () => {
    const onChange = vi.fn();
    render(
      <ProcedureRunner
        task={baseTask}
        taskData={{ flush_completed: true }}
        onChange={onChange}
      />,
    );
    const stepOne = screen.getByRole("button", { name: /Step one/ });
    fireEvent.click(stepOne);
    // Auto would be true; manual override flips it to false
    expect(onChange).toHaveBeenCalledWith({
      flush_completed: true,
      _steps: { 1: false },
    });
  });

  it("flips back when clicked again (true → false)", () => {
    const onChange = vi.fn();
    render(
      <ProcedureRunner
        task={baseTask}
        taskData={{ _steps: { 1: true } }}
        onChange={onChange}
      />,
    );
    const stepOne = screen.getByRole("button", { name: /Step one/ });
    fireEvent.click(stepOne);
    expect(onChange).toHaveBeenCalledWith({ _steps: { 1: false } });
  });

  it("renders the (override) hint when manual disagrees with auto", () => {
    render(
      <ProcedureRunner
        task={baseTask}
        // auto would say checked (flush_completed=true) but manual override = false
        taskData={{ flush_completed: true, _steps: { 1: false } }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("(override)")).toBeInTheDocument();
  });
});
