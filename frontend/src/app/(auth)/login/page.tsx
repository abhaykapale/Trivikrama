import Image from "next/image";
import { Suspense } from "react";
import { BadgeCheck, FileClock, LockKeyhole, ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";
import { LoadingScreen } from "@/components/feedback/loading-screen";

export const metadata = { title: "Secure sign in" };

export default function LoginPage() {
  return (
    <main className="login-page" id="main-content">
      <section className="login-brand-panel" aria-label="Platform introduction">
        <div className="login-brand">
          <Image src="/logo.svg" alt="" width={36} height={36} priority />
          <div><strong>Trivikrama</strong><span>Security Operations</span></div>
        </div>
        <div className="login-message">
          <span className="eyebrow">Enterprise security analytics</span>
          <h1>Security operations platform</h1>
          <p>Monitor, investigate, and respond to security activity through a tenant-isolated operational workspace.</p>
        </div>
        <ul className="trust-list">
          <li><BadgeCheck /><span><strong>Policy-controlled access</strong>Server-enforced authentication and role permissions</span></li>
          <li><LockKeyhole /><span><strong>Protected sessions</strong>HttpOnly session cookies and request integrity controls</span></li>
          <li><FileClock /><span><strong>Accountable operations</strong>Security-relevant activity is recorded for audit</span></li>
        </ul>
        <div className="login-classification"><ShieldCheck size={15} aria-hidden="true" /><span>Authorized organizational use only</span></div>
      </section>
      <section className="login-form-panel">
        <div className="login-card">
          <div className="mobile-brand"><Image src="/logo.svg" alt="" width={34} height={34} /><div><strong>Trivikrama</strong><span>Security Operations</span></div></div>
          <span className="eyebrow">Secure workspace</span>
          <h2>Sign in</h2>
          <p>Use your assigned security operations account.</p>
          <Suspense fallback={<LoadingScreen label="Preparing secure sign in" />}><LoginForm /></Suspense>
          <div className="login-footnote"><LockKeyhole size={14} aria-hidden="true" /><span>Credentials are transmitted securely and are not stored by this application.</span></div>
        </div>
      </section>
    </main>
  );
}
