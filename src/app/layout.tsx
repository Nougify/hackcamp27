import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { ToastProvider } from "@/components/ui";
import "./globals.css";

const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Chefly",
  description: "Scan your groceries, cook what expires first, hands-free.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${manrope.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
