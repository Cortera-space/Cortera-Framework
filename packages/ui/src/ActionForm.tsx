"use client";

import React, { useState, useCallback } from "react";
import type { DefinedAction } from "@cortera/core";
import type { FieldDescriptor, SelectOption } from "./types";
import { zodToFormSchema } from "./zod-to-form-schema";

export interface ActionFormProps<T = unknown> {
  action: DefinedAction<any>;
  onSuccess?: (result: T) => void;
  onError?: (error: Error | string) => void;
  basePath?: string;
  actorId?: string;
  actorType?: "human" | "agent" | "system";
}

export function ActionForm<T = unknown>({
  action,
  onSuccess,
  onError,
  basePath = "/actions",
  actorId,
  actorType,
}: ActionFormProps<T>) {
  const fields = React.useMemo(() => zodToFormSchema(action.input), [action.input]);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error" | "pending">("idle");
  const [result, setResult] = useState<T | null>(null);
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(null);

  const updateField = useCallback((path: string, value: unknown) => {
    setFormData((prev) => setNestedValue(prev, path, value));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setServerErrors((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setStatus("submitting");
      setErrors({});
      setServerErrors({});
      setServerMessage(null);

      const parseResult = action.input.safeParse(formData);
      if (!parseResult.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parseResult.error.issues) {
          const path = issue.path.join(".");
          fieldErrors[path] = issue.message;
        }
        setErrors(fieldErrors);
        setStatus("error");
        onError?.(new Error("Validation failed"));
        return;
      }

      try {
        if (actorId && actorType) {
          document.cookie = `cortera-session=${encodeURIComponent(JSON.stringify({ actorId, actorType }))}; path=/`;
        }

        const response = await fetch(`${basePath}/${action.name}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(parseResult.data),
          credentials: "include",
        });

        const data = await response.json();

        if (response.status === 200) {
          setResult(data.result as T);
          setFormData({});
          setStatus("success");
          onSuccess?.(data.result as T);
        } else if (response.status === 400) {
          const fieldErrors: Record<string, string> = {};
          if (Array.isArray(data.details)) {
            for (const issue of data.details) {
              const path = issue.path?.join(".") || "form";
              fieldErrors[path] = issue.message;
            }
          }
          setServerErrors(fieldErrors);
          setServerMessage(data.error || "Invalid input");
          setStatus("error");
          onError?.(new Error(data.error));
        } else if (response.status === 403) {
          const reason =
            data.reason === "ACTOR_CONTAINED" || data.reason === "ACTOR_REVOKED"
              ? `Action contained: ${data.error}`
              : `Not permitted: ${data.error}`;
          setServerMessage(reason);
          setStatus("error");
          onError?.(new Error(reason));
        } else if (response.status === 202) {
          setPendingApprovalId(data.approvalId);
          setStatus("pending");
          onError?.(new Error("Pending approval"));
        } else if (response.status === 401) {
          setServerMessage("Unauthorized: no actor identity found");
          setStatus("error");
          onError?.(new Error("Unauthorized"));
        } else {
          setServerMessage(data.error || `Request failed with status ${response.status}`);
          setStatus("error");
          onError?.(new Error(data.error));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setServerMessage(message);
        setStatus("error");
        onError?.(err instanceof Error ? err : new Error(message));
      }
    },
    [action, formData, basePath, onSuccess, onError, actorId, actorType]
  );

  if (status === "success" && result !== null) {
    return (
      <div style={{ padding: "1rem", border: "1px solid green", marginBottom: "1rem" }}>
        <h3>Success</h3>
        <pre>{JSON.stringify(result, null, 2)}</pre>
      </div>
    );
  }

  if (status === "pending" && pendingApprovalId) {
    return (
      <div style={{ padding: "1rem", border: "1px solid orange", marginBottom: "1rem" }}>
        <h3>Pending Approval</h3>
        <p>This action requires approval. Approval ID: <code>{pendingApprovalId}</code></p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: "600px" }}>
      <h2>{action.description}</h2>
      {fields.map((field) =>
        renderField(field, "", formData, updateField, errors, serverErrors)
      )}
      {serverMessage && (
        <div style={{ color: "red", marginBottom: "1rem" }}>{serverMessage}</div>
      )}
      <button type="submit" disabled={status === "submitting"}>
        {status === "submitting" ? "Submitting..." : "Submit"}
      </button>
    </form>
  );
}

interface ArrayFieldProps {
  field: FieldDescriptor;
  pathPrefix: string;
  values: unknown[];
  onChange: (values: unknown[]) => void;
  error?: string;
  formData: Record<string, unknown>;
  updateField: (path: string, value: unknown) => void;
  errors: Record<string, string>;
  serverErrors: Record<string, string>;
}

function ArrayField({
  field,
  pathPrefix,
  values,
  onChange,
  error,
  formData,
  updateField,
  errors,
  serverErrors,
}: ArrayFieldProps) {
  const addItem = () => {
    if (field.metadata?.itemControlType === "object") {
      onChange([...values, {}]);
    } else {
      onChange([...values, ""]);
    }
  };

  const removeItem = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, itemValue: unknown) => {
    const next = [...values];
    next[index] = itemValue;
    onChange(next);
  };

  return (
    <div>
      {values.map((item, index) => {
        if (field.metadata?.itemControlType === "object" && field.metadata?.itemFields) {
          const itemObj = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          return (
            <div
              key={index}
              style={{ border: "1px solid #ddd", padding: "0.5rem", marginBottom: "0.5rem" }}
            >
              {field.metadata.itemFields.map((f: FieldDescriptor) =>
                renderField(f, `${pathPrefix}.${index}`, itemObj, updateField, errors, serverErrors)
              )}
              <button type="button" onClick={() => removeItem(index)} style={{ marginTop: "0.5rem" }}>
                Remove
              </button>
            </div>
          );
        }

        return (
          <div key={index} style={{ marginBottom: "0.5rem" }}>
            <input
              type={field.metadata?.itemControlType === "number" ? "number" : "text"}
              value={(item as string | number | undefined) ?? ""}
              onChange={(e) => {
                let newValue: unknown = e.target.value;
                if (field.metadata?.itemControlType === "number") {
                  newValue = e.target.value === "" ? "" : Number(e.target.value);
                }
                updateItem(index, newValue);
              }}
            />
            <button type="button" onClick={() => removeItem(index)} style={{ marginLeft: "0.5rem" }}>
              Remove
            </button>
          </div>
        );
      })}
      <button type="button" onClick={addItem} style={{ marginTop: "0.5rem" }}>
        Add {field.label}
      </button>
      {error && <div style={{ color: "red" }}>{error}</div>}
    </div>
  );
}

function renderField(
  field: FieldDescriptor,
  pathPrefix: string,
  formData: Record<string, unknown>,
  updateField: (path: string, value: unknown) => void,
  errors: Record<string, string>,
  serverErrors: Record<string, string>
): React.ReactNode {
  const fullPath = pathPrefix ? `${pathPrefix}.${field.name}` : field.name;
  const inputId = fullPath.replace(/\./g, "-");
  const value = getNestedValue(formData, fullPath);
  const error = errors[fullPath] || serverErrors[fullPath];

  switch (field.controlType) {
    case "object":
      return (
        <fieldset key={fullPath} style={{ marginBottom: "1rem", border: "1px solid #ccc", padding: "1rem" }}>
          <legend>
            {field.label} {field.required ? "*" : ""}
          </legend>
          {field.metadata?.fields?.map((f: FieldDescriptor) =>
            renderField(f, fullPath, formData, updateField, errors, serverErrors)
          )}
        </fieldset>
      );
    case "array":
      return (
        <div key={fullPath} style={{ marginBottom: "1rem" }}>
          <label htmlFor={`${inputId}-add`}>
            {field.label} {field.required ? "*" : ""}
          </label>
          <ArrayField
            field={field}
            pathPrefix={fullPath}
            values={Array.isArray(value) ? value : []}
            onChange={(newValues) => updateField(fullPath, newValues)}
            error={error}
            formData={formData}
            updateField={updateField}
            errors={errors}
            serverErrors={serverErrors}
          />
        </div>
      );
    case "checkbox":
      return (
        <div key={fullPath} style={{ marginBottom: "0.5rem" }}>
          <label>
            <input
              id={inputId}
              type="checkbox"
              checked={!!value}
              onChange={(e) => updateField(fullPath, e.target.checked)}
            />
            {field.label} {field.required ? "*" : ""}
          </label>
          {error && <div style={{ color: "red" }}>{error}</div>}
        </div>
      );
    default: {
      const inputType = field.controlType === "select" ? "select" : field.controlType;
      return (
        <div key={fullPath} style={{ marginBottom: "0.5rem" }}>
          <label htmlFor={inputId}>
            {field.label} {field.required ? "*" : ""}
          </label>
          {field.controlType === "select" && field.metadata?.options ? (
            <select
              id={inputId}
              value={(value as string) ?? ""}
              onChange={(e) => updateField(fullPath, e.target.value)}
              required={field.required}
            >
              <option value="">-- select --</option>
              {field.metadata.options!.map((opt: SelectOption) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={inputId}
              type={inputType}
              value={(value as string | number | undefined) ?? ""}
              onChange={(e) => {
                let newValue: unknown = e.target.value;
                if (field.controlType === "number") {
                  newValue = e.target.value === "" ? undefined : Number(e.target.value);
                }
                updateField(fullPath, newValue);
              }}
              required={field.required}
            />
          )}
          {error && <div style={{ color: "red" }}>{error}</div>}
        </div>
      );
    }
  }
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === "object" && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  if (!path) return value as Record<string, unknown>;
  const parts = path.split(".");
  const result: Record<string, unknown> = { ...obj };
  let current: Record<string, unknown> = result;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const next = current[part];
    if (next && typeof next === "object") {
      current[part] = { ...(next as Record<string, unknown>) };
      current = current[part] as Record<string, unknown>;
    } else {
      current[part] = {};
      current = current[part] as Record<string, unknown>;
    }
  }

  current[parts[parts.length - 1]] = value;
  return result;
}
