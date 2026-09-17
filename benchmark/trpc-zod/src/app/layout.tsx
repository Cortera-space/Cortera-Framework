import { TRPCClientProvider } from "./components/TRPCClientProvider";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TRPCClientProvider>{children}</TRPCClientProvider>
      </body>
    </html>
  );
}