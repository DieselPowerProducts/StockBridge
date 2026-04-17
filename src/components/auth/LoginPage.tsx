import { useEffect, useRef, useState } from "react";
import { signInWithGoogle } from "../../services/api";
import type { AuthUser } from "../../types";

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleAccounts = {
  id: {
    initialize: (options: {
      client_id: string;
      callback: (response: GoogleCredentialResponse) => void;
    }) => void;
    renderButton: (
      parent: HTMLElement,
      options: {
        size: "large";
        theme: "outline";
        text: "signin_with";
        shape: "rectangular";
        width: number;
      }
    ) => void;
  };
};

declare global {
  interface Window {
    google?: {
      accounts: GoogleAccounts;
    };
  }
}

type LoginPageProps = {
  onLogin: (user: AuthUser) => void;
};

const googleScriptSrc = "https://accounts.google.com/gsi/client";
let googleScriptPromise: Promise<void> | null = null;

function loadGoogleScript() {
  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }

  if (googleScriptPromise) {
    return googleScriptPromise;
  }

  googleScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${googleScriptSrc}"]`
    );

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Unable to load Google Sign-In.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = googleScriptSrc;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load Google Sign-In."));
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as
    | string
    | undefined;

  useEffect(() => {
    let isMounted = true;

    async function initializeGoogleButton() {
      if (!googleClientId) {
        setError("Google login is not configured yet.");
        return;
      }

      try {
        await loadGoogleScript();

        if (!isMounted || !buttonRef.current || !window.google?.accounts?.id) {
          return;
        }

        buttonRef.current.innerHTML = "";
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (response) => {
            if (!response.credential) {
              setError("Google did not return a sign-in credential.");
              return;
            }

            setIsSigningIn(true);
            setError("");

            try {
              const result = await signInWithGoogle(response.credential);
              onLogin(result.user);
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : "Unable to sign in with Google."
              );
            } finally {
              if (isMounted) {
                setIsSigningIn(false);
              }
            }
          }
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          size: "large",
          theme: "outline",
          text: "signin_with",
          shape: "rectangular",
          width: 320
        });
      } catch (err) {
        if (isMounted) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load Google Sign-In."
          );
        }
      }
    }

    initializeGoogleButton();

    return () => {
      isMounted = false;
    };
  }, [googleClientId, onLogin]);

  return (
    <main className="auth-page" aria-labelledby="loginHeading">
      <section className="auth-panel">
        <p className="eyebrow">StockBridge</p>
        <h1 id="loginHeading">Sign in to continue</h1>
        <p className="auth-copy">
          Use your Diesel Power Products Google account.
        </p>

        <div className="google-button-wrap" ref={buttonRef} />

        {isSigningIn && <p className="status-message">Signing you in...</p>}
        {error && <p className="status-message error-message">{error}</p>}
      </section>
    </main>
  );
}
