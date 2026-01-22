import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const config = window.APP_CONFIG || {};
const userChip = document.getElementById("user-chip");
const userInitials = document.getElementById("user-initials");
const userName = document.getElementById("user-name");
const signOutButton = document.getElementById("signout-button");
const redirectTarget = `${window.location.pathname.split("/").pop() || "index.html"}${window.location.search}${window.location.hash}`;
const redirectParam = encodeURIComponent(redirectTarget);

const getInitials = (value) => {
  if (!value) return "?";
  const parts = value.trim().split(/\s+/);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("");
  return initials || "?";
};

const setUserChip = (username) => {
  if (!userChip) return;
  if (username) {
    if (userName) userName.textContent = username;
    if (userInitials) userInitials.textContent = getInitials(username);
    userChip.classList.add("is-visible");
    if (signOutButton) {
      signOutButton.classList.add("is-visible");
    }
  } else {
    if (userName) userName.textContent = "";
    if (userInitials) userInitials.textContent = "?";
    userChip.classList.remove("is-visible");
    if (signOutButton) {
      signOutButton.classList.remove("is-visible");
    }
  }
};
if (!config.supabaseUrl || !config.supabaseAnonKey) {
  console.warn("Supabase config missing. Auth gate disabled.");
} else {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  const adminDomain = (config.preparerEmailDomain || "").toLowerCase().replace(/^@/, "");

  const requireAuth = async () => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) {
      setUserChip("");
      window.location.href = `login.html?redirect=${redirectParam}`;
      return;
    }
    if (adminDomain && user.email?.toLowerCase().endsWith(`@${adminDomain}`)) {
      window.location.href = "preparer.html";
      return;
    }

    const primaryProfile = await supabase
      .from("profiles")
      .select("username, full_name, phone")
      .eq("id", user.id)
      .maybeSingle();
    let profile = primaryProfile.error ? null : primaryProfile.data;
    if (primaryProfile.error) {
      const fallbackProfile = await supabase
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .maybeSingle();
      profile = fallbackProfile.error ? null : fallbackProfile.data;
    }

    if (!profile?.username) {
      setUserChip("");
      window.location.href = `login.html?redirect=${redirectParam}`;
      return;
    }

    const displayName = profile?.full_name || profile?.username;
    setUserChip(displayName);
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

  if (userChip) {
    userChip.addEventListener("click", () => {
      const isExpanded = userChip.classList.toggle("is-expanded");
      userChip.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    });
    document.addEventListener("click", (event) => {
      if (!userChip.contains(event.target)) {
        userChip.classList.remove("is-expanded");
        userChip.setAttribute("aria-expanded", "false");
      }
    });
  }

  if (signOutButton) {
    signOutButton.addEventListener("click", async () => {
      await supabase.auth.signOut();
      setUserChip("");
      window.location.href = `login.html?redirect=${redirectParam}`;
    });
  }

  requireAuth();
}
