import type { Metadata } from "next";
import WelcomePage from "./components/welcome/WelcomePage";

/**
 * Home — the landing page (ads, social, "How it works"). The market board
 * lives at /predict; /welcome redirects here (next.config.js).
 */
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

export default function HomePage() {
  return <WelcomePage />;
}
