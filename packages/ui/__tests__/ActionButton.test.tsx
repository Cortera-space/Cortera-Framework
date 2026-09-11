import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { z } from "zod";
import { defineAction } from "@tera/core";
import { ActionButton } from "../src/ActionButton";

function createAction(name: string, schema: z.ZodType<any>) {
  return defineAction({
    name,
    description: `Test action ${name}`,
    permission: "test.run",
    inputSchema: schema,
    handler: async () => ({ ok: true }),
  });
}

describe("ActionButton", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders button with action name", () => {
    const action = createAction("testAction", z.object({ name: z.string() }));
    render(<ActionButton action={action} input={{ name: "Test" }} />);
    expect(screen.getByRole("button", { name: /run testaction/i })).toBeDefined();
  });

  it("calls onSuccess with result on successful submit", async () => {
    const action = createAction("test", z.object({ name: z.string() }));
    const onSuccess = vi.fn();

    global.fetch = vi.fn(() =>
      Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ result: { id: "1" } }),
      } as Response)
    );

    render(<ActionButton action={action} input={{ name: "Test" }} onSuccess={onSuccess} />);

    await userEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({ id: "1" });
    });
  });

  it("renders permission-denied message on 403", async () => {
    const action = createAction("test", z.object({ name: z.string() }));
    const onError = vi.fn();

    global.fetch = vi.fn(() =>
      Promise.resolve({
        status: 403,
        json: () => Promise.resolve({ error: "Permission denied", reason: "deny" }),
      } as Response)
    );

    render(<ActionButton action={action} input={{ name: "Test" }} onError={onError} />);

    await userEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText(/not permitted/i)).toBeDefined();
    });
  });

  it("renders pending-approval state on 202", async () => {
    const action = createAction("test", z.object({ name: z.string() }));
    const onError = vi.fn();

    global.fetch = vi.fn(() =>
      Promise.resolve({
        status: 202,
        json: () => Promise.resolve({ status: "pending", approvalId: "approval-456" }),
      } as Response)
    );

    render(<ActionButton action={action} input={{ name: "Test" }} onError={onError} />);

    await userEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText(/pending approval/i)).toBeDefined();
      expect(screen.getByText("approval-456")).toBeDefined();
    });
  });
});
