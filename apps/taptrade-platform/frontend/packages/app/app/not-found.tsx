import Link from "next/link";

// Styling lives in globals.css (`.not-found-*`, `.home-button`): a
// Martian Mono numeral, a poster-type title and the ink action.

export default function NotFound() {
  return (
    <div className="not-found-container">
      <div className="not-found-content">
        <div className="not-found-code">404</div>
        <h1 className="not-found-title">Page Not Found</h1>
        <p className="not-found-message">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link href="/" className="home-button">
          Back to Home
        </Link>
      </div>
    </div>
  );
}
