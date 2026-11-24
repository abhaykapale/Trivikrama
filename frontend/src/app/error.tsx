"use client";
import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
export default function ErrorPage({ error, reset }: { readonly error: Error & { digest?: string }; readonly reset: () => void }) {
  useEffect(() => { console.error("Frontend boundary error", error); }, [error]);
  return <main className="error-page" id="main-content"><TriangleAlert size={34} /><h1>Something went wrong</h1><p>The workspace could not complete this operation.</p><button className="primary-button compact" onClick={reset}>Try again</button></main>;
}
