const authScreen = document.getElementById("auth-screen");
const appShell = document.getElementById("app-shell");
const googleSignin = document.getElementById("google-signin");
const authError = document.getElementById("auth-error");
const accountName = document.getElementById("account-name");

function showAuthError(message) {
  authError.textContent = message;
  authError.hidden = false;
}

function enterApp(user) {
  accountName.textContent = user?.name || user?.email || "there";
  authScreen.hidden = true;
  appShell.hidden = false;
}

async function finishGoogleSignIn(response) {
  try {
    const result = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: response.credential }),
    });
    const data = await result.json();
    if (!result.ok) throw new Error(data.error || "Google sign-in failed.");
    enterApp(data.user);
  } catch (error) {
    showAuthError(error.message);
  }
}

function loadGoogleIdentityServices(clientId) {
  const script = document.createElement("script");
  script.src = "https://accounts.google.com/gsi/client";
  script.async = true;
  script.defer = true;
  script.onload = () => {
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: finishGoogleSignIn,
      ux_mode: "popup",
    });
    window.google.accounts.id.renderButton(googleSignin, {
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "rectangular",
      width: 280,
    });
  };
  script.onerror = () => showAuthError("Google sign-in could not load. Please try again.");
  document.head.append(script);
}

async function initializeAuth() {
  try {
    const sessionResponse = await fetch("/api/auth/me");
    const session = await sessionResponse.json();
    if (session.user) {
      enterApp(session.user);
      return;
    }

    const configResponse = await fetch("/api/auth/config");
    const config = await configResponse.json();
    if (!config.clientId) {
      showAuthError("Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID to your environment.");
      return;
    }
    loadGoogleIdentityServices(config.clientId);
  } catch {
    showAuthError("We could not load sign-in. Please refresh and try again.");
  }
}

initializeAuth();