import { CreateInvoiceForm } from "./components/CreateInvoiceForm";

export default function InvoicePage() {
  return (
    <main style={{ minHeight: "100vh", backgroundColor: "#f9fafb", padding: "40px 20px" }}>
      <CreateInvoiceForm />
    </main>
  );
}