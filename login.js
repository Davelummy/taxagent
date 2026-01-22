import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const config = window.APP_CONFIG || {};
const loginForm = document.getElementById("login-form");
const loginMessage = document.getElementById("login-message");
const loginEmail = document.getElementById("login-email");
const loginButton = loginForm?.querySelector('button[type="submit"]');
const authTabs = document.querySelectorAll(".auth-tab");
const signupFields = document.getElementById("signup-fields");
const signupName = document.getElementById("signup-name");
const signupPhone = document.getElementById("signup-phone");
const otpForm = document.getElementById("otp-form");
const otpCode = document.getElementById("otp-code");
const otpMessage = document.getElementById("otp-message");
const usernamePanel = document.getElementById("username-panel");
const onboardForm = document.getElementById("onboard-form");
const onboardMessage = document.getElementById("onboard-message");
const onboardUsername = document.getElementById("onboard-username");
const onboardName = document.getElementById("onboard-name");
const onboardPhone = document.getElementById("onboard-phone");

const authContext = document.body?.dataset?.auth || "client";
const isAdminAuth = authContext === "admin";
const redirectOverride = document.body?.dataset?.redirect;
const redirectTo =
  new URLSearchParams(window.location.search).get("redirect") ||
  redirectOverride ||
  "dashboard.html";

const missingConfig = !config.supabaseUrl || !config.supabaseAnonKey;
const supabase = missingConfig ? null : createClient(config.supabaseUrl, config.supabaseAnonKey);

const setMessage = (element, message, type = "info") => {
  if (!element) return;
  element.textContent = message;
  element.className = `portal-message ${type}`.trim();
};

let authMode = window.sessionStorage.getItem("auth_mode") || "signin";

const setAuthMode = (mode) => {
  authMode = mode === "signup" ? "signup" : "signin";
  window.sessionStorage.setItem("auth_mode", authMode);
  authTabs.forEach((tab) => {
    const isActive = tab.dataset.mode === authMode;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  if (signupFields) {
    signupFields.classList.toggle("is-hidden", authMode !== "signup");
  }
  if (signupName) {
    signupName.required = authMode === "signup";
  }
  if (signupPhone) {
    signupPhone.required = authMode === "signup";
  }
};

authTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setAuthMode(tab.dataset.mode || "signin");
  });
});

if (isAdminAuth) {
  setAuthMode("signin");
} else {
  setAuthMode(authMode);
}

const toggleUsernamePanel = (show) => {
  if (!usernamePanel) return;
  if (show) {
    usernamePanel.classList.remove("is-hidden");
  } else {
    usernamePanel.classList.add("is-hidden");
  }
};

const fetchProfile = async (user) => {
  if (!supabase || !user) return null;
  const primary = await supabase
    .from("profiles")
    .select("username, full_name, phone")
    .eq("id", user.id)
    .maybeSingle();
  if (!primary.error) {
    return primary.data;
  }
  const fallback = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();
  if (fallback.error) return null;
  return fallback.data;
};

const syncProfileToNeon = async (user, profile) => {
  if (!user?.id || !user?.email) return;
  try {
    await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supabase_user_id: user.id,
        email: user.email,
        username: profile?.username || "",
        full_name: profile?.full_name || user.user_metadata?.full_name || "",
        phone: profile?.phone || user.user_metadata?.phone || "",
      }),
    });
  } catch (error) {
    console.warn("Profile sync failed", error);
  }
};

const syncPreparerToNeon = async (user) => {
  if (!user?.id || !user?.email) return;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    await fetch("/api/preparer/profile", {
      method: "POST",
      headers,
      body: JSON.stringify({
        supabase_user_id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || "",
        phone: user.user_metadata?.phone || "",
      }),
    });
  } catch (error) {
    console.warn("Preparer profile sync failed", error);
  }
};

const handleSession = async (user) => {
  if (!user) {
    toggleUsernamePanel(false);
    return;
  }
  if (isAdminAuth) {
    await syncPreparerToNeon(user);
    window.location.href = redirectTo;
    return;
  }
  const profile = await fetchProfile(user);
  if (profile?.username) {
    await syncProfileToNeon(user, profile);
    window.location.href = redirectTo;
  } else {
    if (onboardName && !onboardName.value) {
      onboardName.value = window.sessionStorage.getItem("signup_name") || "";
    }
    if (onboardPhone && !onboardPhone.value) {
      onboardPhone.value = window.sessionStorage.getItem("signup_phone") || "";
    }
    toggleUsernamePanel(true);
  }
};

if (loginForm && supabase) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = loginEmail?.value.trim();
    if (!email) {
      setMessage(loginMessage, "Enter a valid email address.", "error");
      return;
    }
    const adminDomain = (config.preparerEmailDomain || "").toLowerCase().replace(/^@/, "");
    if (isAdminAuth && adminDomain && !email.toLowerCase().endsWith(`@${adminDomain}`)) {
      setMessage(loginMessage, `Use your @${adminDomain} email to access preparer tools.`, "error");
      return;
    }
    if (!isAdminAuth && adminDomain && email.toLowerCase().endsWith(`@${adminDomain}`)) {
      setMessage(loginMessage, "Use the preparer portal to sign in.", "error");
      return;
    }
    if (authMode === "signup") {
      const fullName = signupName?.value.trim();
      const phone = signupPhone?.value.trim();
      if (!fullName || fullName.length < 3) {
        setMessage(loginMessage, "Enter your full legal name to create an account.", "error");
        return;
      }
      const digits = phone ? phone.replace(/\D/g, "") : "";
      if (!digits || digits.length < 10) {
        setMessage(loginMessage, "Enter a valid mobile phone number.", "error");
        return;
      }
      window.sessionStorage.setItem("signup_name", fullName);
      window.sessionStorage.setItem("signup_phone", phone);
    }
    if (loginButton?.disabled) {
      return;
    }
    window.sessionStorage.setItem("login_email", email);
    setMessage(loginMessage, "Sending one-time code...", "info");
    if (loginButton) {
      loginButton.disabled = true;
    }
    const shouldCreateUser = isAdminAuth ? true : authMode === "signup";
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser,
        ...(authMode === "signup"
          ? {
              data: {
                full_name: window.sessionStorage.getItem("signup_name") || "",
                phone: window.sessionStorage.getItem("signup_phone") || "",
              },
            }
          : {}),
      },
    });

    if (error) {
      const rawMessage = error.message || "Unable to send code.";
      if (authMode === "signin" && !isAdminAuth) {
        const lower = rawMessage.toLowerCase();
        if (lower.includes("sign up") || lower.includes("signup") || lower.includes("not found")) {
          setMessage(loginMessage, "No account found. Use Create account to sign up.", "error");
        } else {
          setMessage(loginMessage, rawMessage, "error");
        }
      } else {
        setMessage(loginMessage, rawMessage, "error");
      }
      if (loginButton) {
        loginButton.disabled = false;
      }
      return;
    }

    setMessage(loginMessage, "Code sent. Check your email.", "success");
    setMessage(otpMessage, "Enter the 6-digit code from your email.", "info");

    if (loginButton) {
      let seconds = 30;
      loginButton.textContent = `Resend in ${seconds}s`;
      const interval = setInterval(() => {
        seconds -= 1;
        if (seconds <= 0) {
          clearInterval(interval);
          loginButton.disabled = false;
          loginButton.textContent = "Send one-time code";
          return;
        }
        loginButton.textContent = `Resend in ${seconds}s`;
      }, 1000);
    }
  });
}

const verifyOtpCode = async (email, code) => {
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
  return error || null;
};

if (otpForm && supabase) {
  otpForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = loginEmail?.value.trim() || window.sessionStorage.getItem("login_email");
    const code = otpCode?.value.trim();
    if (!email) {
      setMessage(otpMessage, "Enter your email above first.", "error");
      return;
    }
    if (!code || code.length !== 6) {
      setMessage(otpMessage, "Enter the 6-digit code from your email.", "error");
      return;
    }
    setMessage(otpMessage, "Verifying code...", "info");
    const error = await verifyOtpCode(email, code);
    if (error) {
      setMessage(otpMessage, error.message || "Invalid code.", "error");
      return;
    }
    setMessage(otpMessage, "Verified. Continuing...", "success");
    const { data } = await supabase.auth.getSession();
    await handleSession(data.session?.user || null);
  });
}

if (onboardForm && supabase) {
  onboardForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = onboardUsername?.value.trim();
    if (!username || username.length < 3) {
      setMessage(onboardMessage, "Username must be at least 3 characters.", "error");
      return;
    }
    const fullName = onboardName?.value.trim();
    const phone = onboardPhone?.value.trim();
    if (!fullName || fullName.length < 3) {
      setMessage(onboardMessage, "Full legal name is required.", "error");
      return;
    }
    const phoneDigits = phone ? phone.replace(/\D/g, "") : "";
    if (!phoneDigits || phoneDigits.length < 10) {
      setMessage(onboardMessage, "Enter a valid mobile phone number.", "error");
      return;
    }

    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) {
      setMessage(onboardMessage, "Session expired. Please sign in again.", "error");
      toggleUsernamePanel(false);
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .upsert({ id: user.id, username, full_name: fullName, phone }, { onConflict: "id" });

    if (error) {
      setMessage(onboardMessage, "Username not available. Try another.", "error");
      return;
    }

    await syncProfileToNeon(user, { username, full_name: fullName, phone });
    setMessage(onboardMessage, "Username saved. Redirecting...", "success");
    window.location.href = redirectTo;
  });
}

const init = async () => {
  if (!supabase) return;

  const { data } = await supabase.auth.getSession();
  await handleSession(data.session?.user || null);

  supabase.auth.onAuthStateChange((_event, session) => {
    handleSession(session?.user || null);
  });
};

init();
