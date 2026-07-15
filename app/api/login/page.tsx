"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const from = searchParams.get("from") || "/";

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("Mot de passe incorrect.");
        setLoading(false);
        return;
      }
      router.push(from);
      router.refresh();
    } catch {
      setError("Une erreur est survenue. Réessaie.");
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        background: "#f7f7f8",
      }}
    >
      <div
        style={{
          background: "white",
          padding: "2.5rem",
          borderRadius: "12px",
          boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
          width: "100%",
          maxWidth: "360px",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", marginBottom: "1.5rem", textAlign: "center" }}>
          LeadFox Sales Hub
        </h1>

        <button
          onClick={() => signIn("google", { callbackUrl: from })}
          style={{
            width: "100%",
            padding: "0.75rem",
            borderRadius: "8px",
            border: "1px solid #ddd",
            background: "white",
            fontSize: "0.95rem",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            marginBottom: "1.5rem",
          }}
        >
          Se connecter avec Google
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", margin: "1rem 0" }}>
          <div style={{ flex: 1, height: 1, background: "#eee" }} />
          <span style={{ fontSize: "0.75rem", color: "#999" }}>ou</span>
          <div style={{ flex: 1, height: 1, background: "#eee" }} />
        </div>

        <form onSubmit={handlePasswordSubmit}>
          <input
            type="password"
            placeholder="Mot de passe partagé"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              width: "100%",
              padding: "0.65rem",
              borderRadius: "8px",
              border: "1px solid #ddd",
              marginBottom: "0.75rem",
              fontSize: "0.95rem",
              boxSizing: "border-box",
            }}
          />
          {error && (
            <p style={{ color: "#c0392b", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading || password.length === 0}
            style={{
              width: "100%",
              padding: "0.7rem",
              borderRadius: "8px",
              border: "none",
              background: "#111",
              color: "white",
              fontSize: "0.95rem",
              cursor: loading || password.length === 0 ? "default" : "pointer",
              opacity: loading || password.length === 0 ? 0.6 : 1,
            }}
          >
            {loading ? "Connexion..." : "Entrer"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
