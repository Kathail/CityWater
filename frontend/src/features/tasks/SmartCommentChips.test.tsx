import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SmartCommentChips } from "./SmartCommentChips";
import type { SmartComment } from "./api";

const COMMENTS: SmartComment[] = [
  {
    id: "cleared",
    condition: "outcome == 'cleared'",
    text: "Cleared after {min} min.",
    variables: ["min"],
  },
  {
    id: "still_bad",
    condition: "outcome == 'still_discoloured'",
    text: "Still discoloured.",
  },
  {
    id: "always",
    text: "No condition — always shown.",
  },
];

describe("SmartCommentChips", () => {
  it("renders only chips whose condition is satisfied", () => {
    render(
      <SmartCommentChips
        smartComments={COMMENTS}
        taskData={{ outcome: "cleared", min: 8 }}
        onPick={() => {}}
      />,
    );
    expect(screen.getByText("Cleared after 8 min.")).toBeInTheDocument();
    expect(screen.queryByText("Still discoloured.")).not.toBeInTheDocument();
    expect(screen.getByText("No condition — always shown.")).toBeInTheDocument();
  });

  it("disables chips with unresolved variables and surfaces the missing field", () => {
    render(
      <SmartCommentChips
        smartComments={COMMENTS}
        taskData={{ outcome: "cleared" }}
        onPick={() => {}}
      />,
    );
    // The rendered text still appears (so the operator sees what the
    // suggestion *will* say once they fill the gap) but the chip is
    // disabled and a "fill min" caption surfaces the missing field.
    expect(screen.getByText("Cleared after ? min.")).toBeInTheDocument();
    expect(screen.getByText("fill min")).toBeInTheDocument();
    const chip = screen.getByTitle(/Fill min above/);
    expect(chip.getAttribute("aria-disabled")).toBe("true");
    expect(chip.tagName.toLowerCase()).toBe("span");
  });

  it("does not call onPick when a disabled chip is clicked", () => {
    const onPick = vi.fn();
    render(
      <SmartCommentChips
        smartComments={COMMENTS}
        taskData={{ outcome: "cleared" }}
        onPick={onPick}
      />,
    );
    fireEvent.click(screen.getByText("Cleared after ? min."));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("calls onPick with the rendered text when tapped", () => {
    const onPick = vi.fn();
    render(
      <SmartCommentChips
        smartComments={COMMENTS}
        taskData={{ outcome: "cleared", min: 12 }}
        onPick={onPick}
      />,
    );
    fireEvent.click(screen.getByText("Cleared after 12 min."));
    expect(onPick).toHaveBeenCalledWith("Cleared after 12 min.");
  });

  it("renders nothing when no chips would show", () => {
    const { container } = render(
      <SmartCommentChips
        smartComments={[{ id: "x", condition: "outcome == 'never'", text: "hidden" }]}
        taskData={{}}
        onPick={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when smart_comments is undefined", () => {
    const { container } = render(
      <SmartCommentChips smartComments={undefined} taskData={{}} onPick={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
