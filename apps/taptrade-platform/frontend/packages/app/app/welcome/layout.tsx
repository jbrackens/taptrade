import type { Metadata } from "next";
import type React from "react";

// Campaign landing page for ads and social links. "/" is the market board;
// this page tells the story first.
export const metadata: Metadata = {
  title: "Tap Trade — Call it before it happens",
  description:
    "Pick Yes or No on the moments Filipinos are talking about: basketball, esports, pageants, showbiz and more. Free to play with points. 18+.",
  openGraph: {
    title: "Tap Trade — Call it before it happens",
    description:
      "Pick Yes or No on the moments Filipinos are talking about. Free to play with points. 18+.",
    images: ["/images/covers/showbiz.jpg"],
  },
};

export default function WelcomeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
