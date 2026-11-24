import Link from "next/link";
export default function NotFound() { return <main className="error-page" id="main-content"><span className="error-code">404</span><h1>Page not found</h1><p>The requested security workspace route does not exist.</p><Link className="primary-button compact" href="/">Return to dashboard</Link></main>; }
