import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodToFormSchema, type FieldDescriptor } from "../src/zod-to-form-schema";

describe("zodToFormSchema", () => {
  it("maps z.string to text control", () => {
    const schema = z.object({ name: z.string() });
    const fields = zodToFormSchema(schema);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      name: "name",
      label: "Name",
      controlType: "text",
      required: true,
    });
  });

  it("uses describe() for label when present", () => {
    const schema = z.object({ name: z.string().describe("Full name") });
    const fields = zodToFormSchema(schema);
    expect(fields[0]).toMatchObject({
      label: "Full name",
    });
  });

  it("maps z.string().email to email control", () => {
    const schema = z.object({ email: z.string().email() });
    const fields = zodToFormSchema(schema);
    expect(fields[0]).toMatchObject({
      name: "email",
      controlType: "email",
      required: true,
    });
  });

  it("maps z.number to number control", () => {
    const schema = z.object({ count: z.number() });
    const fields = zodToFormSchema(schema);
    expect(fields[0]).toMatchObject({
      name: "count",
      controlType: "number",
      required: true,
    });
  });

  it("maps z.enum to select control with options", () => {
    const schema = z.object({ status: z.enum(["active", "inactive"]) });
    const fields = zodToFormSchema(schema);
    expect(fields[0]).toMatchObject({
      name: "status",
      controlType: "select",
      required: true,
    });
    expect(fields[0].metadata?.options).toEqual([
      { value: "active", label: "active" },
      { value: "inactive", label: "inactive" },
    ]);
  });

  it("maps z.boolean to checkbox control", () => {
    const schema = z.object({ active: z.boolean() });
    const fields = zodToFormSchema(schema);
    expect(fields[0]).toMatchObject({
      name: "active",
      controlType: "checkbox",
      required: true,
    });
  });

  it("maps z.date to date control", () => {
    const schema = z.object({ birthDate: z.date() });
    const fields = zodToFormSchema(schema);
    expect(fields[0]).toMatchObject({
      name: "birthDate",
      controlType: "date",
      required: true,
    });
  });

  it("marks optional fields as not required", () => {
    const schema = z.object({ note: z.string().optional() });
    const fields = zodToFormSchema(schema);
    expect(fields[0]).toMatchObject({
      name: "note",
      controlType: "text",
      required: false,
    });
  });

  it("recursively extracts fields from nested objects", () => {
    const schema = z.object({
      address: z.object({
        street: z.string(),
        city: z.string(),
      }),
    });
    const fields = zodToFormSchema(schema);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      name: "address",
      controlType: "object",
      required: true,
    });
    expect(fields[0].metadata?.fields).toHaveLength(2);
    expect(fields[0].metadata?.fields?.[0]).toMatchObject({
      name: "street",
      controlType: "text",
    });
    expect(fields[0].metadata?.fields?.[1]).toMatchObject({
      name: "city",
      controlType: "text",
    });
  });

  it("extracts array item control type and fields", () => {
    const schema = z.object({
      tags: z.array(z.string()),
    });
    const fields = zodToFormSchema(schema);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      name: "tags",
      controlType: "array",
      required: true,
    });
    expect(fields[0].metadata?.itemControlType).toBe("text");
  });

  it("extracts array of objects with nested fields", () => {
    const schema = z.object({
      addresses: z.array(
        z.object({
          street: z.string(),
          zip: z.string(),
        })
      ),
    });
    const fields = zodToFormSchema(schema);
    expect(fields).toHaveLength(1);
    expect(fields[0].metadata?.itemControlType).toBe("object");
    expect(fields[0].metadata?.itemFields).toHaveLength(2);
    expect(fields[0].metadata?.itemFields?.[0]).toMatchObject({
      name: "street",
      controlType: "text",
    });
  });

  it("handles mixed field types in a single schema", () => {
    const schema = z.object({
      title: z.string().describe("Note title"),
      count: z.number(),
      active: z.boolean(),
      role: z.enum(["admin", "user"]),
      email: z.string().email(),
      birthday: z.date(),
      note: z.string().optional(),
    });
    const fields = zodToFormSchema(schema);
    expect(fields).toHaveLength(7);
    expect(fields.map((f) => f.controlType)).toEqual([
      "text",
      "number",
      "checkbox",
      "select",
      "email",
      "date",
      "text",
    ]);
    expect(fields.map((f) => f.required)).toEqual([true, true, true, true, true, true, false]);
  });
});
