import type { Metadata } from "next";
import { Archivo, Newsreader } from "next/font/google";
import AppTopBar from "@/components/AppTopBar";
import "./globals.css";

/** Everything the app says. */
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-archivo",
});

/** Only the names a person gave something: journeys, places, people. */
// Weight is left variable so the optical-size axis can come along: next/font
// only allows `axes` when the weight is not pinned to a fixed list.
const newsreader = Newsreader({
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
  variable: "--font-newsreader",
});

export const metadata: Metadata = {
  title: {
    default: "Atlas",
    template: "%s · Atlas",
  },
  description: "Capture a Place. Build a Journey. Explore Atlas.",
  icons: {
    icon: "/brand/atlas-mark.png",
    apple: "/brand/atlas-mark.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <AppTopBar />
        {children}
      </body>
    </html>
  );
}
