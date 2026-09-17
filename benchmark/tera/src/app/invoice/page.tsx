"use client";

import { ActionForm } from "@tera/ui";
import { createInvoiceAction } from "@/actions/createInvoice";

export default function InvoicePage() {
  return (
    <main style={{ minHeight: "100vh", backgroundColor: "#f9fafb", padding: "40px 20px" }}>
      <div style={{ maxWidth: "500px", margin: "0 auto" }}>
        <h2>Create Invoice (Tera)</h2>
        <ActionForm action={createInvoiceAction} apiBaseUrl="/api/actions" />
      </div>
    </main>
  );
}