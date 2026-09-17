"use client";

import { useState } from "react";
import { trpc } from "./utils/trpc";

interface CreateInvoiceFormData {
  customerId: string;
  amount: string;
  dueDate: string;
  notes: string;
}

export function CreateInvoiceForm() {
  const [formData, setFormData] = useState<CreateInvoiceFormData>({
    customerId: "",
    amount: "",
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    notes: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof CreateInvoiceFormData, string>>>({});
  const [response, setResponse] = useState<{ result?: unknown; error?: string; data?: unknown } | null>(null);

  const mutation = trpc.createInvoice.useMutation({
    onSuccess: (data) => {
      setResponse({ result: data, error: undefined });
      setFormData({ customerId: "", amount: "", dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0], notes: "" });
    },
    onError: (error) => {
      setResponse({ error: error.message, data: error.data });
      if (error.data?.zodError) {
        const zodErrors = error.data.zodError as Array<{ path: (string | number)[]; message: string }>;
        zodErrors.forEach((detail) => {
          const field = detail.path[0] as keyof CreateInvoiceFormData;
          if (field in formData) {
            setErrors((prev) => ({ ...prev, [field]: detail.message }));
          }
        });
      }
    },
  });

  const validateField = (name: keyof CreateInvoiceFormData, value: string): string | undefined => {
    switch (name) {
      case "customerId":
        if (!value.trim()) return "Customer ID is required";
        break;
      case "amount":
        const num = Number(value);
        if (isNaN(num) || num <= 0) return "Amount must be a positive number";
        break;
      case "dueDate":
        if (!value) return "Due date is required";
        if (isNaN(Date.parse(value))) return "Due date must be a valid date";
        break;
      case "notes":
        break;
    }
    return undefined;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    const error = validateField(name as keyof CreateInvoiceFormData, value);
    setErrors((prev) => ({ ...prev, [name]: error }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setResponse(null);

    const hasErrors = (Object.keys(formData) as Array<keyof CreateInvoiceFormData>).some((key) => {
      const error = validateField(key, formData[key]);
      if (error) {
        setErrors((prev) => ({ ...prev, [key]: error }));
        return true;
      }
      return false;
    });

    if (hasErrors) return;

    mutation.mutate({
      customerId: formData.customerId,
      amount: Number(formData.amount),
      dueDate: new Date(formData.dueDate).toISOString(),
      notes: formData.notes || undefined,
    });
  };

  return (
    <div style={{ maxWidth: "500px", margin: "0 auto", padding: "20px", fontFamily: "system-ui" }}>
      <h2>Create Invoice (tRPC)</h2>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div>
          <label htmlFor="customerId" style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
            Customer ID
          </label>
          <input
            id="customerId"
            name="customerId"
            type="text"
            value={formData.customerId}
            onChange={handleChange}
            style={{
              width: "100%",
              padding: "8px 12px",
              border: errors.customerId ? "1px solid #dc2626" : "1px solid #d1d5db",
              borderRadius: "4px",
              fontSize: "16px",
            }}
            placeholder="cust-123"
          />
          {errors.customerId && <span style={{ color: "#dc2626", fontSize: "14px" }}>{errors.customerId}</span>}
        </div>

        <div>
          <label htmlFor="amount" style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
            Amount
          </label>
          <input
            id="amount"
            name="amount"
            type="number"
            step="0.01"
            value={formData.amount}
            onChange={handleChange}
            style={{
              width: "100%",
              padding: "8px 12px",
              border: errors.amount ? "1px solid #dc2626" : "1px solid #d1d5db",
              borderRadius: "4px",
              fontSize: "16px",
            }}
            placeholder="99.99"
          />
          {errors.amount && <span style={{ color: "#dc2626", fontSize: "14px" }}>{errors.amount}</span>}
        </div>

        <div>
          <label htmlFor="dueDate" style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
            Due Date
          </label>
          <input
            id="dueDate"
            name="dueDate"
            type="date"
            value={formData.dueDate}
            onChange={handleChange}
            style={{
              width: "100%",
              padding: "8px 12px",
              border: errors.dueDate ? "1px solid #dc2626" : "1px solid #d1d5db",
              borderRadius: "4px",
              fontSize: "16px",
            }}
          />
          {errors.dueDate && <span style={{ color: "#dc2626", fontSize: "14px" }}>{errors.dueDate}</span>}
        </div>

        <div>
          <label htmlFor="notes" style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
            Notes (optional)
          </label>
          <textarea
            id="notes"
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            rows={3}
            style={{
              width: "100%",
              padding: "8px 12px",
              border: errors.notes ? "1px solid #dc2626" : "1px solid #d1d5db",
              borderRadius: "4px",
              fontSize: "16px",
              fontFamily: "inherit",
              resize: "vertical",
            }}
            placeholder="Optional notes about this invoice..."
          />
          {errors.notes && <span style={{ color: "#dc2626", fontSize: "14px" }}>{errors.notes}</span>}
        </div>

        <button
          type="submit"
          disabled={mutation.isPending}
          style={{
            padding: "12px 24px",
            backgroundColor: mutation.isPending ? "#9ca3af" : "#2563eb",
            color: "white",
            border: "none",
            borderRadius: "4px",
            fontSize: "16px",
            fontWeight: 500,
            cursor: mutation.isPending ? "not-allowed" : "pointer",
          }}
        >
          {mutation.isPending ? "Creating..." : "Create Invoice"}
        </button>

        {response && (
          <div
            style={{
              padding: "16px",
              borderRadius: "4px",
              backgroundColor: response.error ? "#fef2f2" : "#f0fdf4",
              border: `1px solid ${response.error ? "#fecaca" : "#bbf7d0"}`,
            }}
          >
            {response.error ? (
              <>
                <strong style={{ color: "#dc2626" }}>Error:</strong> {response.error}
              </>
            ) : (
              <>
                <strong style={{ color: "#16a34a" }}>Success!</strong> Invoice created:
                <pre style={{ marginTop: "8px", fontSize: "12px", background: "#f3f4f6", padding: "8px", borderRadius: "4px" }}>
                  {JSON.stringify(response.result, null, 2)}
                </pre>
              </>
            )}
          </div>
        )}
      </form>
    </div>
  );
}