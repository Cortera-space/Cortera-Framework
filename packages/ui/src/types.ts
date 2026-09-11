export type FieldControlType =
  | "text"
  | "email"
  | "number"
  | "select"
  | "checkbox"
  | "date"
  | "object"
  | "array";

export interface SelectOption {
  value: string;
  label: string;
}

export interface FieldDescriptor {
  name: string;
  label: string;
  controlType: FieldControlType;
  required: boolean;
  description?: string;
  metadata?: {
    options?: SelectOption[];
    fields?: FieldDescriptor[];
    itemControlType?: FieldControlType;
    itemFields?: FieldDescriptor[];
  };
}
