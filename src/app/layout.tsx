import type { Metadata } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";

// Two families, two jobs: a serif for display, a sans for everything you
// operate. The v1 guidelines call this the editorial pairing.
const display = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
});

const ui = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Planora",
  description: "Sistema operacional de projetos.",
};

/**
 * Applies the stored theme before first paint. Without it the page renders in
 * the default theme and then swaps, which is the flash every themed site is
 * judged by.
 */
const themeScript = `try{var t=localStorage.getItem("planora-theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${display.variable} ${ui.variable} h-full antialiased`}
      /**
       * The script below writes `data-theme` onto this element before React
       * hydrates — which is the point of it, and which React otherwise reports
       * as an attribute the server never rendered. Suppressed for this element
       * only, one level deep: everything inside it is still checked.
       */
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="pln-ground min-h-full">{children}</body>
    </html>
  );
}
