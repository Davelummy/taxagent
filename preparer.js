import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { scanFiles } from "./upload-security.js";

const config = window.APP_CONFIG || {};
const userChip = document.getElementById("user-chip");
const userInitials = document.getElementById("user-initials");
const userName = document.getElementById("user-name");
const signOutButton = document.getElementById("signout-button");
const accessTitle = document.getElementById("preparer-access-title");
const accessNote = document.getElementById("preparer-access-note");
const prepSections = document.querySelectorAll("[data-preparer-section]");
const prepMessage = document.getElementById("preparer-message");
const intakeFilter = document.getElementById("prep-intake-filter");
const queueList = document.getElementById("preparer-queue-list");
const clientGrid = document.getElementById("preparer-client-grid");
const prepSync = document.getElementById("prep-sync");
const storageStatus = document.getElementById("prep-storage-status");
const storageNote = document.getElementById("prep-storage-note");
const telemetryButton = document.getElementById("prep-telemetry-button");
const preparerSystem = document.getElementById("preparer-system");
const totalClients = document.getElementById("prep-total-clients");
const totalIntakes = document.getElementById("prep-total-intakes");
const awaitingDocs = document.getElementById("prep-awaiting-docs");
const awaitingAuth = document.getElementById("prep-awaiting-8879");
const readyToFile = document.getElementById("prep-ready-file");

const allowedTypes = config.allowedFileTypes || ["application/pdf", "image/jpeg", "image/png"];
const maxUploadSize = (config.maxUploadSizeMb || 10) * 1024 * 1024;
const buildTimestamp = () => new Date().toISOString().replace(/[-:.TZ]/g, "");

let supabaseClient = null;

const statusOptions = [
  { value: "received", label: "Received" },
  { value: "in_review", label: "In review" },
  { value: "awaiting_documents", label: "Awaiting documents" },
  { value: "awaiting_authorization", label: "Awaiting Form 8879" },
  { value: "ready_to_file", label: "Ready to file" },
  { value: "filed", label: "Filed" },
];

const statusBadgeMap = {
  received: "pending",
  in_review: "pending",
  awaiting_documents: "required",
  awaiting_authorization: "required",
  ready_to_file: "pending",
  filed: "received",
};

const reviewLabels = {
  received: "Received",
  in_review: "In review",
  awaiting_documents: "Awaiting documents",
  awaiting_authorization: "Awaiting Form 8879",
  ready_to_file: "Ready to file",
  filed: "Filed",
};

const normalizeUsername = (value) =>
  value ? value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "_") : "";

const normalizeFileName = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const fileNameMatches = (fileName, tokens) => {
  const normalized = normalizeFileName(fileName);
  return tokens.some((token) => normalized.includes(normalizeFileName(token)));
};

const docMatchers = [
  { label: "Form 8879", tokens: ["8879"], requirement: "auth" },
  { label: "W-2", tokens: ["w2", "w-2", "w_2"], requirement: "income" },
  { label: "1099", tokens: ["1099"], requirement: "income" },
  { label: "1098", tokens: ["1098"], requirement: "mortgage" },
  { label: "Photo ID", tokens: ["photoid", "photo", "passport", "driverlicense", "driver", "license", "idcard", "id"], requirement: "identity" },
  { label: "Schedule K-1", tokens: ["k1", "k-1", "schedulek1", "schedulek-1"], requirement: "income" },
  { label: "HSA", tokens: ["hsa", "form8889"], requirement: "other" },
];

const detectDocumentType = (name, category) => {
  if (!name) return { label: "Document", requirement: "other" };
  if (category === "authorization") {
    return { label: "Form 8879", requirement: "auth" };
  }
  const normalized = normalizeFileName(name);
  for (const matcher of docMatchers) {
    if (matcher.tokens.some((token) => normalized.includes(normalizeFileName(token)))) {
      return { label: matcher.label, requirement: matcher.requirement };
    }
  }
  return { label: "Document", requirement: "other" };
};

const buildRequirementSummary = (files) => {
  const status = {
    income: false,
    mortgage: false,
    identity: false,
    auth: false,
  };
  files.forEach((file) => {
    const detected = file.document_type
      ? detectDocumentType(file.document_type, file.category)
      : detectDocumentType(file.name || "", file.category);
    if (detected.requirement in status) {
      status[detected.requirement] = true;
    }
  });
  return status;
};

const setMessage = (message, type = "info") => {
  if (!prepMessage) return;
  prepMessage.textContent = message;
  prepMessage.className = `portal-message ${type}`.trim();
};

const formatDate = (value, withTime = false) => {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return withTime ? date.toLocaleString() : date.toLocaleDateString();
};

const formatBytes = (bytes) => {
  if (!bytes) return "0 KB";
  const k = 1024;
  const sizes = ["KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

const getInitials = (value) => {
  if (!value) return "?";
  const parts = value.trim().split(/\s+/);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
  return initials || "?";
};

const setUserChip = (displayName) => {
  if (!userChip) return;
  if (displayName) {
    if (userName) userName.textContent = displayName;
    if (userInitials) userInitials.textContent = getInitials(displayName);
    userChip.classList.add("is-visible");
    signOutButton?.classList.add("is-visible");
  } else {
    if (userName) userName.textContent = "";
    if (userInitials) userInitials.textContent = "?";
    userChip.classList.remove("is-visible");
    signOutButton?.classList.remove("is-visible");
  }
};

const setAccessState = (title, note, allow) => {
  if (accessTitle) accessTitle.textContent = title;
  if (accessNote) accessNote.textContent = note;
  prepSections.forEach((section) => {
    section.hidden = !allow;
  });
};

const buildStatusBadge = (status) => {
  const normalized = reviewLabels[status] ? status : "received";
  const badgeClass = statusBadgeMap[normalized] || "pending";
  return `<span class="status-badge ${badgeClass}">${reviewLabels[normalized]}</span>`;
};

const buildFollowUpTags = (stats, reviewStatus) => {
  if (!stats) return "";
  const tags = [];
  if (!stats.documents) {
    tags.push("Docs missing");
  }
  if (!stats.authorizations) {
    tags.push("Form 8879 missing");
  }
  if (!tags.length && reviewStatus === "awaiting_documents") {
    tags.push("Awaiting documents");
  }
  return tags
    .map((tag) => `<span class="queue-tag">${tag}</span>`)
    .join("");
};

const renderQueue = (intakes, uploadStats = {}) => {
  if (!queueList) return;
  if (!intakes.length) {
    queueList.innerHTML = `<div class="dashboard-card">No intake submissions yet.</div>`;
    return;
  }

  queueList.innerHTML = "";
  const header = document.createElement("div");
  header.className = "queue-row queue-header";
  header.innerHTML = `
    <div>Client</div>
    <div>Filing year</div>
    <div>Status</div>
    <div>Review update</div>
    <div>Action</div>
  `;
  queueList.appendChild(header);

  intakes.forEach((item) => {
    const clientName = [item.first_name, item.last_name].filter(Boolean).join(" ") || "Unnamed client";
    const username = item.client_username || item.profile_username || "N/A";
    const usernameKey = normalizeUsername(username);
    const stats = uploadStats?.[usernameKey];
    const searchIndex = `${clientName} ${item.email || ""} ${username}`.toLowerCase();
    const row = document.createElement("div");
    row.className = "queue-row";
    row.dataset.intakeId = item.id || "";
    row.dataset.clientUserId = item.client_user_id || "";
    row.dataset.email = item.email || "";
    row.dataset.createdAt = item.created_at || "";
    row.dataset.search = searchIndex;
    row.innerHTML = `
      <div class="queue-cell">
        <p class="queue-title">${clientName}</p>
        <p class="queue-meta">${username !== "N/A" ? `@${username}` : "No username"} - ${item.email || "No email"}</p>
      </div>
      <div class="queue-cell">${item.filing_year || "N/A"}</div>
      <div class="queue-cell">
        ${buildStatusBadge(item.review_status)}
        <p class="queue-meta">Submitted ${formatDate(item.created_at)}</p>
        <div class="queue-tags">${buildFollowUpTags(stats, item.review_status)}</div>
      </div>
      <div class="queue-cell">
        <label class="queue-label">
          <span>Status</span>
          <select class="queue-status">
            ${statusOptions
              .map((option) => `<option value="${option.value}" ${option.value === item.review_status ? "selected" : ""}>${option.label}</option>`)
              .join("")}
          </select>
        </label>
        <label class="queue-label">
          <span>Notes</span>
          <textarea class="queue-notes" rows="2" placeholder="Add preparer notes...">${item.review_notes || ""}</textarea>
        </label>
      </div>
      <div class="queue-cell queue-actions">
        <button class="primary button-compact queue-save" type="button">Save update</button>
        <p class="queue-meta">Updated ${formatDate(item.review_updated_at)}</p>
      </div>
    `;
    queueList.appendChild(row);
  });
};

const renderClients = (clients, uploadStats, uploadStatsAvailable) => {
  if (!clientGrid) return;
  if (!clients.length) {
    clientGrid.innerHTML = `<div class="dashboard-card">No client profiles found.</div>`;
    return;
  }
  clientGrid.innerHTML = "";

  clients.forEach((client) => {
    const displayName = client.full_name || client.username || client.email || "Client";
    const initials = getInitials(displayName);
    const usernameKey = normalizeUsername(client.username || "");
    const stats = uploadStats?.[usernameKey];
    const docsCount = stats?.documents ?? null;
    const authCount = stats?.authorizations ?? null;
    const lastUpload = stats?.last_upload_at ? formatDate(stats.last_upload_at, true) : "N/A";
    const status = client.intake_status || "received";

    const card = document.createElement("div");
    card.className = "dashboard-card client-card";
    card.dataset.usernameKey = usernameKey;
    card.dataset.userId = client.supabase_user_id || "";
    card.innerHTML = `
      <div class="client-header">
        <div class="client-avatar">${initials}</div>
        <div>
          <p class="client-name">${displayName}</p>
          <p class="client-meta">${client.username ? `@${client.username}` : "Username pending"} - ${client.email || "No email"}</p>
        </div>
        <div class="client-header-actions">
          ${buildStatusBadge(status)}
          <button class="ghost client-collapse" type="button" aria-expanded="true">
            <span class="collapse-label">Collapse</span>
            <span class="collapse-icon" aria-hidden="true">▾</span>
          </button>
        </div>
      </div>
      <div class="client-details">
        <p><strong>Phone:</strong> ${client.phone || "Not provided"}</p>
        <p><strong>Latest intake:</strong> ${formatDate(client.intake_created_at)}</p>
        <p><strong>Filing year:</strong> ${client.intake_filing_year || "N/A"}</p>
      </div>
      <div class="client-tags">
        ${
          uploadStatsAvailable
            ? `
              <span class="client-tag">Docs: ${docsCount ?? 0}</span>
              <span class="client-tag">Form 8879: ${authCount ? "Received" : "Missing"}</span>
              <span class="client-tag">Last upload: ${lastUpload}</span>
            `
            : `<span class="client-tag">Upload telemetry not connected</span>`
        }
      </div>
      <div class="client-upload">
        <label>
          Upload on behalf of client
          <select class="client-upload-type">
            <option value="uploads">Client documents</option>
            <option value="authorizations">Form 8879</option>
          </select>
        </label>
        <input class="client-upload-input" type="file" accept="application/pdf,image/jpeg,image/png" />
        <p class="upload-hint">Max 10 MB • PDF, JPG, PNG</p>
        <button class="ghost client-upload-button" type="button">Upload to client vault</button>
        <p class="client-upload-message"></p>
      </div>
      <div class="client-accordion">
        <button class="ghost accordion-toggle" type="button" aria-expanded="false">
          View uploads
        </button>
        <div class="accordion-panel" hidden>
          <div class="accordion-summary">Loading uploads...</div>
          <div class="accordion-list"></div>
        </div>
      </div>
    `;
    clientGrid.appendChild(card);
  });
};

const applyFilter = () => {
  if (!intakeFilter || !queueList) return;
  const term = intakeFilter.value.trim().toLowerCase();
  const rows = Array.from(queueList.querySelectorAll(".queue-row"))
    .filter((row) => !row.classList.contains("queue-header"));
  let visible = 0;
  rows.forEach((row) => {
    if (!term || row.dataset.search?.includes(term)) {
      row.hidden = false;
      visible += 1;
    } else {
      row.hidden = true;
    }
  });
  if (!term) return;
  if (visible === 0) {
    setMessage("No matches found for that search.", "warning");
  } else {
    setMessage(`Showing ${visible} matched intake${visible === 1 ? "" : "s"}.`, "info");
  }
};

const fetchOverview = async (token, options = {}) => {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const params = new URLSearchParams();
  if (options.telemetry === false) {
    params.set("telemetry", "0");
  }
  const query = params.toString();
  const response = await fetch(`/api/preparer/overview${query ? `?${query}` : ""}`, { headers });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody?.error || "Unable to load preparer data.");
  }
  const data = await response.json();
  if (!data?.ok) {
    throw new Error(data?.error || "Unable to load preparer data.");
  }
  return data;
};

const applyOverview = (data, options = {}) => {
  if (!data) return;
  if (totalClients) totalClients.textContent = data.summary?.total_clients ?? 0;
  if (totalIntakes) totalIntakes.textContent = data.summary?.total_intakes ?? 0;
  if (awaitingDocs) awaitingDocs.textContent = data.summary?.awaiting_documents ?? 0;
  if (awaitingAuth) awaitingAuth.textContent = data.summary?.awaiting_authorization ?? 0;
  if (readyToFile) readyToFile.textContent = data.summary?.ready_to_file ?? 0;

  renderQueue(data.intakes || [], data.upload_stats || {});
  renderClients(data.clients || [], data.upload_stats || {}, Boolean(data.upload_stats_available));

  if (prepSync) {
    const syncTime = data.server_time ? new Date(data.server_time) : new Date();
    prepSync.textContent = `Last sync: ${syncTime.toLocaleString()}`;
  }

  if (preparerSystem) {
    preparerSystem.hidden = false;
  }
  if (data.upload_stats_available) {
    if (storageStatus) {
      storageStatus.textContent = "Connected";
    }
    if (storageNote) {
      storageNote.textContent = "Upload telemetry synced from Supabase storage.";
    }
    if (telemetryButton) {
      telemetryButton.hidden = true;
    }
  } else {
    if (storageStatus) {
      storageStatus.textContent = options.telemetryRequested
        ? "Not connected"
        : "Paused";
    }
    if (storageNote) {
      storageNote.textContent = options.telemetryRequested
        ? "Connect the Supabase service role key to see upload counts by client."
        : "Upload telemetry paused to speed up loading.";
    }
    if (telemetryButton) {
      telemetryButton.hidden = options.telemetryRequested === true;
    }
  }
};

const init = async () => {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    setAccessState("Access blocked", "Supabase configuration missing.", false);
    return;
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  supabaseClient = supabase;
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  const user = session?.user;
  if (!user) {
    const redirectTarget = encodeURIComponent("preparer.html");
    window.location.href = `admin-login.html?redirect=${redirectTarget}`;
    return;
  }

  const adminEmails = Array.isArray(config.preparerEmails)
    ? config.preparerEmails.map((email) => email.toLowerCase())
    : [];
  const adminDomain = (config.preparerEmailDomain || "").toLowerCase().replace(/^@/, "");
  const email = user.email?.toLowerCase() || "";
  const domainAllowed = adminDomain ? email.endsWith(`@${adminDomain}`) : false;
  const listAllowed = adminEmails.length ? adminEmails.includes(email) : false;
  const isAdmin = adminDomain ? domainAllowed : listAllowed;
  if (!isAdmin) {
    setUserChip("");
    const reason = adminDomain
      ? `Only ${adminDomain} team emails are allowed.`
      : "Preparer access is restricted. Configure preparerEmailDomain in config.js.";
    setAccessState("Access restricted", reason, false);
    return;
  }

  const profile = await supabase
    .from("profiles")
    .select("full_name, username")
    .eq("id", user.id)
    .maybeSingle();
  const displayName =
    profile.data?.full_name ||
    profile.data?.username ||
    user.user_metadata?.full_name ||
    user.email ||
    "Preparer";
  setUserChip(displayName);
  const accessMessage = adminDomain
    ? "Preparer console active for ASTA staff."
    : "Preparer console active. Set preparerEmailDomain in config.js to restrict access.";
  setAccessState("Access granted", accessMessage, true);
  setMessage("Loading preparer activity...", "info");

  if (userChip) {
    userChip.addEventListener("click", () => {
      const expanded = userChip.classList.toggle("is-expanded");
      userChip.setAttribute("aria-expanded", expanded ? "true" : "false");
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
      setMessage("Signing out...", "info");
      try {
        await supabase.auth.signOut({ scope: "global" });
      } catch (error) {
        await supabase.auth.signOut();
      }
      try {
        const ref = (config.supabaseUrl || "").split("https://")[1]?.split(".")[0];
        if (ref) {
          window.localStorage.removeItem(`sb-${ref}-auth-token`);
          window.sessionStorage.removeItem(`sb-${ref}-auth-token`);
        }
      } catch (error) {
        // no-op
      }
      setUserChip("");
      window.location.href = "admin-login.html?redirect=preparer.html";
    });
  }

  try {
    const data = await fetchOverview(session?.access_token || "", { telemetry: false });
    applyOverview(data, { telemetryRequested: false });
    setMessage("Preparer dashboard ready.", "success");
  } catch (error) {
    setMessage(error.message || "Unable to load preparer data.", "error");
  }

  if (telemetryButton) {
    telemetryButton.addEventListener("click", async () => {
      telemetryButton.disabled = true;
      telemetryButton.textContent = "Loading telemetry...";
      try {
        const data = await fetchOverview(session?.access_token || "", { telemetry: true });
        applyOverview(data, { telemetryRequested: true });
      } catch (error) {
        setMessage(error.message || "Unable to load telemetry.", "error");
      } finally {
        if (telemetryButton) {
          telemetryButton.disabled = false;
          telemetryButton.textContent = "Load upload telemetry";
        }
      }
    });
  }

  queueList?.addEventListener("click", async (event) => {
    const button = event.target.closest(".queue-save");
    if (!button) return;
    const row = event.target.closest(".queue-row");
    if (!row) return;
    const statusSelect = row.querySelector(".queue-status");
    const notesInput = row.querySelector(".queue-notes");
    const intakeId = row.dataset.intakeId;
    const clientUserId = row.dataset.clientUserId;
    const emailValue = row.dataset.email;
    if (!statusSelect) return;

    const payload = {
      review_status: statusSelect.value,
      review_notes: notesInput?.value?.trim() || "",
    };

    if (intakeId) {
      payload.intake_id = Number(intakeId);
    } else if (clientUserId) {
      payload.client_user_id = clientUserId;
    } else if (emailValue) {
      payload.email = emailValue;
    } else {
      setMessage("Unable to update this intake without an identifier.", "error");
      return;
    }

    button.disabled = true;
    button.classList.add("is-busy");
    button.textContent = "Saving...";
    try {
      const headers = {
        "Content-Type": "application/json",
      };
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
      const response = await fetch("/api/intake/status", {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error("Unable to update intake status.");
      }
      const badgeCell = row.querySelector(".queue-cell:nth-child(3)");
      if (badgeCell) {
        badgeCell.innerHTML = `
          ${buildStatusBadge(statusSelect.value)}
          <p class="queue-meta">Submitted ${formatDate(row.dataset.createdAt)}</p>
        `;
      }
      const updatedMeta = row.querySelector(".queue-actions .queue-meta");
      if (updatedMeta) {
        updatedMeta.textContent = `Updated ${formatDate(new Date(), true)}`;
      }
      setMessage("Status update saved.", "success");
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      setMessage(error.message || "Unable to save update.", "error");
    } finally {
      button.disabled = false;
      button.classList.remove("is-busy");
      button.textContent = "Save update";
    }
  });

  intakeFilter?.addEventListener("input", applyFilter);

  clientGrid?.addEventListener("click", async (event) => {
    const collapseButton = event.target.closest(".client-collapse");
    if (collapseButton) {
      const card = event.target.closest(".client-card");
      if (!card) return;
      const isCollapsed = card.classList.toggle("is-collapsed");
      collapseButton.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
      const label = collapseButton.querySelector(".collapse-label");
      if (label) {
        label.textContent = isCollapsed ? "Expand" : "Collapse";
      }
      const icon = collapseButton.querySelector(".collapse-icon");
      if (icon) {
        icon.textContent = isCollapsed ? "▸" : "▾";
      }
      return;
    }

    const accordionToggle = event.target.closest(".accordion-toggle");
    if (accordionToggle) {
      const card = event.target.closest(".client-card");
      if (!card || !supabaseClient) return;
      const panel = card.querySelector(".accordion-panel");
      const summary = card.querySelector(".accordion-summary");
      const list = card.querySelector(".accordion-list");
      if (!panel || !summary || !list) return;
      const expanded = accordionToggle.getAttribute("aria-expanded") === "true";
      accordionToggle.setAttribute("aria-expanded", expanded ? "false" : "true");
      panel.hidden = expanded;
      accordionToggle.textContent = expanded ? "View uploads" : "Hide uploads";
      if (expanded) return;
      if (panel.dataset.loaded === "true") return;

      const usernameKey = card.dataset.usernameKey;
      const userId = card.dataset.userId;
      if (!usernameKey) {
        summary.textContent = "Client username missing. Ask the client to complete onboarding.";
        return;
      }

      summary.textContent = "Loading uploads...";
      try {
        const { data } = await supabaseClient.auth.getSession();
        const token = data.session?.access_token || "";
        const params = new URLSearchParams({ username: usernameKey });
        if (userId) {
          params.set("user_id", userId);
        }
        const response = await fetch(`/api/preparer/uploads?${params.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) {
          throw new Error("Unable to load uploads.");
        }
        const result = await response.json();
        const files = Array.isArray(result.files) ? result.files : [];
        if (!files.length) {
          summary.textContent = "No uploads found for this client.";
          list.innerHTML = "";
          panel.dataset.loaded = "true";
          return;
        }
        const requirements = buildRequirementSummary(files);
        summary.innerHTML = `
          <div class="requirement-tags">
            <span class="requirement-tag ${requirements.income ? "is-complete" : ""}">W-2/1099</span>
            <span class="requirement-tag ${requirements.mortgage ? "is-complete" : ""}">1098</span>
            <span class="requirement-tag ${requirements.identity ? "is-complete" : ""}">Photo ID</span>
            <span class="requirement-tag ${requirements.auth ? "is-complete" : ""}">Form 8879</span>
          </div>
        `;
        list.innerHTML = files
          .map((file) => {
            const detected = file.document_type
              ? detectDocumentType(file.document_type, file.category)
              : detectDocumentType(file.name || "", file.category);
            const date = formatDate(file.created_at);
            const size = formatBytes(file.size || 0);
            const scanLabel =
              file.scan_status === "flagged" ? "Flagged" : file.scan_status === "clean" ? "Screened" : "";
            const scanClass =
              file.scan_status === "flagged" ? "is-flagged" : file.scan_status === "clean" ? "is-clean" : "";
            return `
              <div class="accordion-item">
                <div class="accordion-content">
                  <p class="accordion-file">${file.name}</p>
                  <p class="accordion-meta">${detected.label} - ${date} - ${size}${scanLabel ? ` - ${scanLabel}` : ""}</p>
                </div>
                <div class="accordion-tags">
                  <span class="accordion-tag">${detected.label}</span>
                  ${scanLabel ? `<span class="accordion-tag ${scanClass}">${scanLabel}</span>` : ""}
                </div>
              </div>
            `;
          })
          .join("");
        panel.dataset.loaded = "true";
      } catch (error) {
        summary.textContent = "Upload list unavailable. Check Supabase service role settings.";
      }
      return;
    }
    const button = event.target.closest(".client-upload-button");
    if (!button) return;
    if (!supabaseClient) {
      setMessage("Upload service unavailable. Refresh and sign in again.", "error");
      return;
    }
    const card = event.target.closest(".client-card");
    if (!card) return;
    const usernameKey = card.dataset.usernameKey;
    if (!usernameKey) {
      setMessage("Client username missing. Ask the client to complete onboarding first.", "error");
      return;
    }
    const input = card.querySelector(".client-upload-input");
    const typeSelect = card.querySelector(".client-upload-type");
    const message = card.querySelector(".client-upload-message");
    const file = input?.files?.[0];
    if (!file) {
      if (message) message.textContent = "Select a file before uploading.";
      return;
    }
    if (!allowedTypes.includes(file.type) || file.size > maxUploadSize) {
      if (message) message.textContent = "Unsupported file type or size exceeds 10MB.";
      return;
    }
    const targetFolder = typeSelect?.value === "authorizations" ? "authorizations" : "uploads";
    if (targetFolder === "authorizations" && !fileNameMatches(file.name, ["8879"])) {
      if (message) {
        message.textContent = "Rename the file to include 8879 (e.g., Form_8879.pdf) before uploading.";
      }
      return;
    }
    let token = "";
    try {
      const sessionData = await supabaseClient.auth.getSession();
      token = sessionData.data.session?.access_token || "";
    } catch (error) {
      token = "";
    }
    if (!token) {
      if (message) message.textContent = "Session expired. Please sign in again.";
      return;
    }

    try {
      const validation = await fetch(`/api/preparer/validate-client?username=${encodeURIComponent(usernameKey)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!validation.ok) {
        throw new Error("Client username not found.");
      }
    } catch (error) {
      if (message) message.textContent = "Client username not found. Confirm the profile first.";
      return;
    }

    if (message) message.textContent = "Scanning file...";
    const scanResult = await scanFiles([file], (status) => {
      if (message) message.textContent = status;
    });
    if (!scanResult.ok) {
      if (message) message.textContent = scanResult.message || "Upload blocked by security screening.";
      return;
    }
    const scanInfo = scanResult.results?.[0];
    const scanStatus = scanInfo ? (scanInfo.dlp ? "flagged" : "clean") : "unknown";
    const scanNotes = scanInfo?.message || "";
    const dlpHits = scanInfo?.dlp ? 1 : 0;
    if (message) message.textContent = "Uploading...";
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${targetFolder}/${usernameKey}/${buildTimestamp()}-${safeName}`;
    const { error } = await supabaseClient.storage
      .from(config.supabaseBucket)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      if (message) message.textContent = `Upload failed: ${error.message || "try again."}`;
      return;
    }
    if (message) {
      message.textContent = scanResult.dlpHits
        ? "Upload complete. Sensitive data was flagged for review."
        : "Upload complete. File added to client vault.";
    }
    await fetch("/api/uploads/record", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        client_username: usernameKey,
        file_name: file.name,
        storage_path: path,
        file_size: file.size,
        file_type: file.type,
        category: targetFolder === "authorizations" ? "authorizations" : "documents",
        scan_status: scanStatus,
        scan_notes: scanNotes,
        dlp_hits: dlpHits,
      }),
    });
    input.value = "";
  });
};

init();
