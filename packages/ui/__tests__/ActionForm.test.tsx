import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { z } from "zod";
import { defineAction } from "@tera/core";
import { ActionForm } from "../src/ActionForm";

const originalFetch = global.fetch;

function createAction(name: string, schema: z.ZodType<any>) {
  return defineAction({
    name,
    description: `Test action ${name}`,
    permission: "test.run",
    inputSchema: schema,
    handler: async () => ({ ok: true }),
  });
}

describe("ActionForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn(() =>
      Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ result: {} }),
      } as Response)
    ) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders fields from schema", () => {
    const action = createAction("test", z.object({ name: z.string(), count: z.number() }));
    render(<ActionForm action={action} />);
    expect(screen.getByLabelText(/name/i)).toBeDefined();
    expect(screen.getByLabelText(/count/i)).toBeDefined();
  });

  it("renders required indicator for required fields", () => {
    const action = createAction("test", z.object({ name: z.string() }));
    render(<ActionForm action={action} />);
    const label = screen.getByText(/name/i);
    expect(label.textContent).toContain("*");
  });

  it("does not render required indicator for optional fields", () => {
    const action = createAction("test", z.object({ note: z.string().optional() }));
    render(<ActionForm action={action} />);
    const label = screen.getByText(/note/i);
    expect(label.textContent).not.toContain("*");
  });

  it("blocks submit and shows errors for invalid input", async () => {
    const action = createAction("test", z.object({ email: z.string().email() }));
    render(<ActionForm action={action} />);

    const input = screen.getByLabelText(/email/i) as HTMLInputElement;
    await userEvent.type(input, "invalid");
    expect(input.value).toBe("invalid");

    const form = screen.getByRole("button", { name: /submit/i }).closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText(/invalid email/i)).toBeDefined();
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls onSuccess with result on successful submit", async () => {
    const action = createAction("test", z.object({ name: z.string() }));
    const onSuccess = vi.fn();

    global.fetch = vi.fn(() =>
      Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ result: { id: "1", name: "Test" } }),
      } as Response)
    );

    render(<ActionForm action={action} onSuccess={onSuccess} />);

    const input = screen.getByLabelText(/name/i) as HTMLInputElement;
    await userEvent.type(input, "Test");
    expect(input.value).toBe("Test");

    const form = screen.getByRole("button", { name: /submit/i }).closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({ id: "1", name: "Test" });
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

    render(<ActionForm action={action} onError={onError} />);

    const input = screen.getByLabelText(/name/i) as HTMLInputElement;
    await userEvent.type(input, "Test");

    const form = screen.getByRole("button", { name: /submit/i }).closest("form")!;
    fireEvent.submit(form);

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
        json: () => Promise.resolve({ status: "pending", approvalId: "approval-123" }),
      } as Response)
    );

    render(<ActionForm action={action} onError={onError} />);

    const input = screen.getByLabelText(/name/i) as HTMLInputElement;
    await userEvent.type(input, "Test");

    const form = screen.getByRole("button", { name: /submit/i }).closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText(/pending approval/i)).toBeDefined();
      expect(screen.getByText("approval-123")).toBeDefined();
    });
  });
});
