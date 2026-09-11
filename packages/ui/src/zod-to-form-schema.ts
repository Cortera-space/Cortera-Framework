import { z } from "zod";
import type { ZodType } from "zod";
import type { FieldDescriptor, FieldControlType, SelectOption } from "./types";

function toTitleCase(str: string): string {
  return str
    .replace(/([A-Z])/g, " $1")
    .replace(/[_\-\s]+/g, " ")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function getSchemaDescription(schema: ZodType): string | undefined {
  return (schema as any)._def?.description;
}

function isOptional(schema: ZodType): boolean {
  return (schema as any)._def?.typeName === "ZodOptional";
}

function unwrapOptional(schema: ZodType): ZodType {
  let current: ZodType = schema;
  while ((current as any)._def?.typeName === "ZodOptional") {
    current = (current as any)._def.innerType;
  }
  return current;
}

function getControlType(schema: ZodType): FieldControlType {
  const typeName = (schema as any)._def?.typeName;
  switch (typeName) {
    case "ZodString":
      if ((schema as any).isEmail) return "email";
      return "text";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "checkbox";
    case "ZodDate":
      return "date";
    case "ZodEnum":
      return "select";
    case "ZodObject":
      return "object";
    case "ZodArray":
      return "array";
    default:
      return "text";
  }
}

function getMetadata(
  schema: ZodType,
  controlType: FieldControlType
): Record<string, unknown> | undefined {
  switch (controlType) {
    case "select": {
      const enumSchema = schema as z.ZodEnum<[string, ...string[]]>;
      const options: SelectOption[] = enumSchema._def.values.map((v) => ({
        value: v,
        label: String(v),
      }));
      return { options };
    }
    default:
      return undefined;
  }
}

function extractFields(schema: ZodType, key: string): FieldDescriptor[] {
  const unwrapped = unwrapOptional(schema);
  const required = !isOptional(schema);
  const description = getSchemaDescription(unwrapped);
  const label = description || toTitleCase(key);
  const controlType = getControlType(unwrapped);

  switch (controlType) {
    case "object": {
      const shape = (unwrapped as z.ZodObject<any>).shape;
      const fields: FieldDescriptor[] = [];
      for (const [fieldKey, fieldSchema] of Object.entries(shape)) {
        fields.push(...extractFields(fieldSchema as ZodType, fieldKey));
      }
      return [
        {
          name: key,
          label,
          controlType: "object",
          required,
          description,
          metadata: { fields },
        },
      ];
    }
    case "array": {
      const itemSchema = (unwrapped as z.ZodArray<any>)._def.type;
      const itemUnwrapped = unwrapOptional(itemSchema);
      const itemControlType = getControlType(itemUnwrapped);
      const itemMetadata = getMetadata(itemUnwrapped, itemControlType);

      let itemFields: FieldDescriptor[] | undefined;
      if (itemControlType === "object") {
        const shape = (itemUnwrapped as z.ZodObject<any>).shape;
        for (const [fieldKey, fieldSchema] of Object.entries(shape)) {
          itemFields = itemFields || [];
          itemFields.push(...extractFields(fieldSchema as ZodType, fieldKey));
        }
      }

      return [
        {
          name: key,
          label,
          controlType: "array",
          required,
          description,
          metadata: {
            itemControlType,
            itemFields,
            ...itemMetadata,
          },
        },
      ];
    }
    default: {
      return [
        {
          name: key,
          label,
          controlType,
          required,
          description,
          metadata: getMetadata(unwrapped, controlType),
        },
      ];
    }
  }
}

export function zodToFormSchema(schema: ZodType): FieldDescriptor[] {
  const unwrapped = unwrapOptional(schema);
  const typeName = (unwrapped as any)._def?.typeName;

  if (typeName === "ZodObject") {
    const shape = (unwrapped as z.ZodObject<any>).shape;
    const fields: FieldDescriptor[] = [];
    for (const [fieldKey, fieldSchema] of Object.entries(shape)) {
      fields.push(...extractFields(fieldSchema as ZodType, fieldKey));
    }
    return fields;
  }

  return extractFields(schema, "");
}
