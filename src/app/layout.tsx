import type { Metadata } from "next";
import AppTabs from "@/components/AppTabs";
import AppTopBar from "@/components/AppTopBar";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Atlas",
    template: "%s · Atlas",
  },
  description: "Spatial memories, mapped and organized into albums.",
  icons: {
    icon: "/brand/atlas-mark.png",
    apple: "/brand/atlas-mark.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <AppTopBar />
        {children}
        <AppTabs />
      </body>
    </html>
  );
}
