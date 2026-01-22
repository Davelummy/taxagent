import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { scanFiles } from "./upload-security.js";

const config = window.APP_CONFIG || {};
const uploadInput = document.getElementById("upload-input");
const uploadDrop = document.getElementById("upload-drop");
const uploadButton = document.getElementById("upload-button");
const uploadMessage = document.getElementById("upload-message");
const uploadProgress = document.getElementById("upload-progress");
const uploadReceipt = document.getElementById("upload-receipt");
const activityList = document.getElementById("activity-list");
const authUploadInput = document.getElementById("auth-upload-input");
const authUploadButton = document.getElementById("auth-upload-button");
const authUploadMessage = document.getElementById("auth-upload-message");
const authUploadProgress = document.getElementById("auth-upload-progress");
const authUploadReceipt = document.getElementById("auth-upload-receipt");
const authStatus = document.getElementById("auth-status");
const metricLastUpload = document.getElementById("metric-last-upload");
const viewerOverlay = document.getElementById("viewer-overlay");
const viewerTitle = document.getElementById("viewer-title");
const viewerMeta = document.getElementById("viewer-meta");
const viewerBody = document.getElementById("viewer-body");
const viewerClose = document.getElementById("viewer-close");
const viewerOpen = document.getElementById("viewer-open");
const reviewStatusBadge = document.getElementById("review-status-badge");
const reviewStatusDetail = document.getElementById("review-status-detail");
const reviewTimeline = document.getElementById("review-timeline");
const reviewUpdated = document.getElementById("review-updated");
const reviewNote = document.getElementById("review-note");
const metricFilingYear = document.getElementById("metric-filing-year");
const intakeStatusValue = document.getElementById("intake-status-value");
const intakeStatusNote = document.getElementById("intake-status-note");
const checklistBadge = document.getElementById("checklist-badge");
const checklistProfile = document.getElementById("checklist-profile");
const checklistIntake = document.getElementById("checklist-intake");
const checklistUploads = document.getElementById("checklist-uploads");
const checklistAuthorization = document.getElementById("checklist-authorization");
const metricFilingYearCard = document.getElementById("metric-filing-year-card");
const metricLastUploadCard = document.getElementById("metric-last-upload-card");
const metricVaultStatusCard = document.getElementById("metric-vault-status-card");
const metricVaultStatus = document.getElementById("metric-vault-status");
const metricVaultStatusNote = document.getElementById("metric-vault-status-note");
const metricFilingYearNote = document.getElementById("metric-filing-year-note");
const refundCard = document.getElementById("refund-card");
const refundValue = document.getElementById("refund-value");
const refundNote = document.getElementById("refund-note");
const authHeaderBadge = document.getElementById("auth-header-badge");
const authOverviewValue = document.getElementById("auth-overview-value");
const authOverviewNote = document.getElementById("auth-overview-note");

const missingConfig = !config.supabaseUrl || !config.supabaseAnonKey || !config.supabaseBucket;
if (missingConfig) {
  uploadButton?.setAttribute("disabled", "true");
  authUploadButton?.setAttribute("disabled", "true");
}

const supabase = missingConfig ? null : createClient(config.supabaseUrl, config.supabaseAnonKey);
const allowedTypes = config.allowedFileTypes || ["application/pdf", "image/jpeg", "image/png"];
const maxUploadSize = (config.maxUploadSizeMb || 10) * 1024 * 1024;
const hiddenTable = config.supabaseHiddenTable || "upload_visibility";
const normalizeUsername = (value) =>
  value ? value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "_") : "";
const buildTimestamp = () => new Date().toISOString().replace(/[-:.TZ]/g, "");
let selectedFiles = [];
const documentNameTokens = [
  "w2",
  "1099",
  "1098",
  "id",
  "passport",
  "license",
  "k1",
  "schedule",
  "receipt",
  "statement",
  "tax",
];
const normalizeFileName = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const fileNameMatches = (fileName, tokens) => {
  const normalized = normalizeFileName(fileName);
  return tokens.some((token) => normalized.includes(normalizeFileName(token)));
};
const genericFilePattern = /^(img|image|scan|document|file|photo|screenshot)[-_\\s]*\\d*/i;
const getDocumentNameError = (file) => {
  const normalized = normalizeFileName(file.name);
  const hasToken = documentNameTokens.some((token) => normalized.includes(token));
  if (!hasToken || genericFilePattern.test(file.name)) {
    return `Rename "${file.name}" to include the document type (e.g., W-2_2025.pdf) and reselect it.`;
  }
  return "";
};

const setMessage = (element, message, type = "info") => {
  if (!element) return;
  element.textContent = message;
  element.className = `portal-message ${type}`.trim();
};

const setProgress = (element, message) => {
  if (!element) return;
  element.textContent = message || "";
};

const setReceipt = (element, receiptId, details) => {
  if (!element) return;
  if (!receiptId) {
    element.innerHTML = "";
    return;
  }
  element.innerHTML = `
    <div class="receipt-item">
      <strong>Upload receipt</strong><br />
      ID: ${receiptId}<br />
      ${details}
    </div>
  `;
};

const recordUpload = async (payload) => {
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch("/api/uploads/record", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.warn("Upload record failed", error);
  }
};

const checklistState = {
  profile: false,
  intake: false,
  uploads: false,
  authorization: false,
};

const setMetricActive = (card, isActive) => {
  if (!card) return;
  card.classList.toggle("is-active", Boolean(isActive));
};

const updateChecklistUI = () => {
  if (checklistProfile) {
    checklistProfile.classList.toggle("is-complete", checklistState.profile);
  }
  if (checklistIntake) {
    checklistIntake.classList.toggle("is-complete", checklistState.intake);
  }
  if (checklistUploads) {
    checklistUploads.classList.toggle("is-complete", checklistState.uploads);
  }
  if (checklistAuthorization) {
    checklistAuthorization.classList.toggle("is-complete", checklistState.authorization);
  }

  const total = Object.keys(checklistState).length;
  const complete = Object.values(checklistState).filter(Boolean).length;
  if (checklistBadge) {
    if (complete === total) {
      checklistBadge.textContent = "Complete";
      checklistBadge.className = "status-badge received";
    } else {
      checklistBadge.textContent = `${complete} of ${total} complete`;
      checklistBadge.className = "status-badge pending";
    }
  }
};

const setMetricSkeletons = (isLoading) => {
  const elements = document.querySelectorAll(".dashboard-metrics .skeleton-text");
  elements.forEach((element) => {
    element.classList.toggle("skeleton-text", isLoading);
  });
};

const renderActivitySkeleton = () => {
  if (!activityList) return;
  activityList.classList.add("is-loading");
  activityList.innerHTML = `
    <div class="activity-item skeleton">
      <div class="activity-file">
        <div class="activity-thumb skeleton-block"></div>
        <div class="activity-details">
          <div class="skeleton-line" style="height: 14px; width: 180px;"></div>
          <div class="skeleton-line" style="height: 12px; width: 140px; margin-top: 8px;"></div>
        </div>
      </div>
      <div class="activity-actions">
        <div class="skeleton-line" style="height: 12px; width: 70px;"></div>
      </div>
    </div>
    <div class="activity-item skeleton">
      <div class="activity-file">
        <div class="activity-thumb skeleton-block"></div>
        <div class="activity-details">
          <div class="skeleton-line" style="height: 14px; width: 200px;"></div>
          <div class="skeleton-line" style="height: 12px; width: 120px; margin-top: 8px;"></div>
        </div>
      </div>
      <div class="activity-actions">
        <div class="skeleton-line" style="height: 12px; width: 70px;"></div>
      </div>
    </div>
    <div class="activity-item skeleton">
      <div class="activity-file">
        <div class="activity-thumb skeleton-block"></div>
        <div class="activity-details">
          <div class="skeleton-line" style="height: 14px; width: 160px;"></div>
          <div class="skeleton-line" style="height: 12px; width: 110px; margin-top: 8px;"></div>
        </div>
      </div>
      <div class="activity-actions">
        <div class="skeleton-line" style="height: 12px; width: 70px;"></div>
      </div>
    </div>
  `;
};

const reviewStatusMap = [
  "received",
  "in_review",
  "awaiting_documents",
  "awaiting_authorization",
  "ready_to_file",
  "filed",
];

const reviewLabels = {
  received: "Received",
  in_review: "In review",
  awaiting_documents: "Awaiting documents",
  awaiting_authorization: "Awaiting Form 8879",
  ready_to_file: "Ready to file",
  filed: "Filed",
};

const vaultStatusMap = {
  received: {
    label: "Intake received",
    note: "Preparer review is queued.",
  },
  in_review: {
    label: "In review",
    note: "Documents and intake details are being validated.",
  },
  awaiting_documents: {
    label: "Action needed",
    note: "Additional documents required to complete filing.",
  },
  awaiting_authorization: {
    label: "Awaiting Form 8879",
    note: "Authorization required before e-file.",
  },
  ready_to_file: {
    label: "Ready to file",
    note: "Packet complete and queued for e-file.",
  },
  filed: {
    label: "Filed",
    note: "Return transmitted to the IRS.",
  },
};

const setReviewStatus = (status, detail, note, updatedAt) => {
  if (!reviewStatusBadge || !reviewTimeline) return;
  const normalized = status && reviewStatusMap.includes(status) ? status : "received";
  const badgeClassMap = {
    received: "pending",
    in_review: "pending",
    awaiting_documents: "required",
    awaiting_authorization: "required",
    ready_to_file: "pending",
    filed: "received",
  };
  reviewStatusBadge.textContent = reviewLabels[normalized] || "Received";
  reviewStatusBadge.className = `status-badge ${badgeClassMap[normalized] || "pending"}`;
  if (reviewStatusDetail) {
    reviewStatusDetail.textContent =
      detail ||
      (normalized === "received"
        ? "Intake received. Your preparer will begin review shortly."
        : "Review status updated by your preparer.");
  }
  if (reviewUpdated) {
    reviewUpdated.textContent = updatedAt ? `Last updated by preparer: ${updatedAt}` : "";
  }
  if (reviewNote) {
    reviewNote.textContent = note || "";
  }
  if (intakeStatusValue) {
    intakeStatusValue.textContent = reviewLabels[normalized] || "Received";
  }
  if (intakeStatusNote) {
    intakeStatusNote.textContent =
      detail ||
      (normalized === "received"
        ? "Complete secure intake to begin preparation."
        : "Review status updated by your preparer.");
  }

  const steps = Array.from(reviewTimeline.querySelectorAll(".timeline-step"));
  const activeIndex = Math.max(reviewStatusMap.indexOf(normalized), 0);
  steps.forEach((step, index) => {
    step.classList.toggle("is-complete", index < activeIndex);
    step.classList.toggle("is-active", index === activeIndex);
  });
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const updateRefundDisplay = (data) => {
  if (!refundValue || !refundCard) return;
  const raw = data?.estimated_refund;
  if (raw === undefined || raw === null || Number.isNaN(Number(raw))) {
    refundValue.textContent = "Estimate pending";
    refundValue.classList.remove("is-positive", "is-negative");
    if (refundNote) {
      refundNote.textContent = "Based on your most recent secure intake.";
    }
    return;
  }
  const value = Number(raw);
  refundValue.textContent = currencyFormatter.format(value);
  refundValue.classList.toggle("is-positive", value >= 0);
  refundValue.classList.toggle("is-negative", value < 0);
  if (refundNote) {
    refundNote.textContent = value >= 0 ? "Estimated refund based on your intake data." : "Estimated amount due based on your intake data.";
  }
};

let lastFocusedElement = null;
let focusTrapEnabled = false;

const closeViewer = () => {
  if (!viewerOverlay) return;
  viewerOverlay.classList.remove("is-visible");
  viewerOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-locked");
  focusTrapEnabled = false;
  if (viewerBody) {
    viewerBody.innerHTML = "";
  }
  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
    lastFocusedElement.focus();
  }
};

const openViewer = ({ url, name, label, type }) => {
  if (!viewerOverlay || !viewerBody || !url) return;
  lastFocusedElement = document.activeElement;
  if (viewerTitle) {
    viewerTitle.textContent = name || "Document preview";
  }
  if (viewerMeta) {
    viewerMeta.textContent = label ? `${label} • Secure preview` : "Secure preview";
  }
  if (viewerOpen) {
    viewerOpen.href = url;
  }

  if (type === "image") {
    viewerBody.innerHTML = `<img src="${url}" alt="${name || "Document preview"}" />`;
  } else if (type === "pdf") {
    viewerBody.innerHTML = `<iframe src="${url}" title="${name || "PDF preview"}"></iframe>`;
  } else {
    viewerBody.innerHTML = `
      <div class="viewer-placeholder">
        Preview not available. Use “Open in new tab” to view this file.
      </div>
    `;
  }

  viewerOverlay.classList.add("is-visible");
  viewerOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-locked");
  focusTrapEnabled = true;
  viewerClose?.focus();
};

const formatBytes = (bytes) => {
  if (bytes === 0) return "0 KB";
  const k = 1024;
  const sizes = ["KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

const fetchProfileForUser = async (user) => {
  if (!supabase || !user) return null;
  const primary = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();
  if (!primary.error) {
    return primary.data;
  }
  return null;
};

const getUserContext = async () => {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  const profile = await fetchProfileForUser(user);
  const username = profile?.username || "";
  return {
    user,
    username,
    usernameKey: normalizeUsername(username),
  };
};

const fetchHiddenPaths = async (userId) => {
  if (!supabase || !userId || !hiddenTable) return new Set();
  const { data, error } = await supabase
    .from(hiddenTable)
    .select("path")
    .eq("user_id", userId)
    .eq("hidden", true);
  if (error || !data) return new Set();
  return new Set(data.map((row) => row.path));
};

const fetchUploadRecords = async () => {
  if (!supabase) return [];
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return [];
    const response = await fetch("/api/uploads/records", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return [];
    const result = await response.json();
    return Array.isArray(result.records) ? result.records : [];
  } catch (error) {
    return [];
  }
};

const listUploads = async (context) => {
  if (!supabase || !activityList || !context?.usernameKey) return { hasUploads: false, hasAny: false };
  renderActivitySkeleton();
  const [uploadsResult, authResult, hiddenPaths, uploadRecords] = await Promise.all([
    supabase.storage
      .from(config.supabaseBucket)
      .list(`uploads/${context.usernameKey}`, { limit: 12, sortBy: { column: "created_at", order: "desc" } }),
    supabase.storage
      .from(config.supabaseBucket)
      .list(`authorizations/${context.usernameKey}`, { limit: 6, sortBy: { column: "created_at", order: "desc" } }),
    fetchHiddenPaths(context.user?.id),
    fetchUploadRecords(),
  ]);

  const uploadError = uploadsResult.error;
  const authError = authResult.error;

  if (uploadError && authError) {
    activityList.classList.remove("is-loading");
    activityList.innerHTML = "<p>Unable to load uploads.</p>";
    if (metricLastUpload) {
      metricLastUpload.textContent = "Unavailable";
    }
    setMetricActive(metricLastUploadCard, false);
    checklistState.uploads = false;
    updateChecklistUI();
    return { hasUploads: false, hasAny: false };
  }

  const uploads = (uploadsResult.data || []).map((item) => ({
    ...item,
    path: `uploads/${context.usernameKey}/${item.name}`,
    label: "Document",
  }));
  const authorizations = (authResult.data || []).map((item) => ({
    ...item,
    path: `authorizations/${context.usernameKey}/${item.name}`,
    label: "Form 8879",
  }));
  const visibleUploads = uploads.filter((item) => !hiddenPaths.has(item.path));
  const visibleAuthorizations = authorizations.filter((item) => !hiddenPaths.has(item.path));
  const hasUploads = visibleUploads.length > 0;

  const allFiles = [...visibleUploads, ...visibleAuthorizations]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 12);

  if (!allFiles.length) {
    activityList.classList.remove("is-loading");
    activityList.innerHTML = "<p>No uploads yet.</p>";
    if (metricLastUpload) {
      metricLastUpload.textContent = "No uploads yet";
    }
    setMetricActive(metricLastUploadCard, false);
    checklistState.uploads = false;
    updateChecklistUI();
    return { hasUploads, hasAny: false };
  }

  const recordMap = new Map(
    (uploadRecords || [])
      .filter((record) => record?.storage_path)
      .map((record) => [record.storage_path, record])
  );

  const paths = allFiles.map((item) => item.path);
  const { data: signedData } = await supabase.storage
    .from(config.supabaseBucket)
    .createSignedUrls(paths, 600);
  const signedMap = new Map(
    (signedData || [])
      .filter((item) => item?.signedUrl && item?.path)
      .map((item) => [item.path, item.signedUrl])
  );

  activityList.classList.remove("is-loading");
  activityList.innerHTML = "";
  if (metricLastUpload) {
    const latest = allFiles[0];
    const latestDate = latest.created_at ? new Date(latest.created_at).toLocaleString() : "Pending";
    metricLastUpload.textContent = latestDate;
  }
  setMetricActive(metricLastUploadCard, true);
  checklistState.uploads = hasUploads;
  updateChecklistUI();
  allFiles.forEach((item) => {
    const row = document.createElement("div");
    row.className = "activity-item";
    const size = item.metadata?.size || 0;
    const created = item.created_at ? new Date(item.created_at).toLocaleDateString() : "";
    const record = recordMap.get(item.path);
    const label = record?.document_type || item.label || "Document";
    const scanStatus = record?.scan_status || "";
    const scanLabel = scanStatus === "flagged" ? "Flagged" : scanStatus === "clean" ? "Screened" : "";
    const scanClass = scanStatus === "flagged" ? "is-flagged" : scanStatus === "clean" ? "is-clean" : "";
    const signedUrl = signedMap.get(item.path);
    const extension = item.name.split(".").pop()?.toLowerCase() || "";
    const mime =
      item.metadata?.mimetype ||
      item.metadata?.mimeType ||
      item.metadata?.contentType ||
      "";
    const isImage =
      mime.startsWith("image/") ||
      ["jpg", "jpeg", "png", "webp", "gif"].includes(extension);
    const isPdf = mime === "application/pdf" || extension === "pdf";
    const thumb = isImage && signedUrl
      ? `<img src="${signedUrl}" alt="${item.name}" loading="lazy" />`
      : `<span class="file-icon">${extension ? extension.toUpperCase() : "FILE"}</span>`;

    row.dataset.url = signedUrl || "";
    row.dataset.name = item.name;
    row.dataset.label = label;
    row.dataset.type = isImage ? "image" : isPdf ? "pdf" : "file";
    row.dataset.size = String(size);
    row.dataset.created = item.created_at || "";
    row.dataset.path = item.path;

    row.innerHTML = `
      <div class="activity-file">
        <div class="activity-thumb">${thumb}</div>
        <div class="activity-details">
          <p class="activity-name">${item.name}</p>
          <p class="activity-meta">${label} • ${created} • ${formatBytes(size)}</p>
        </div>
      </div>
      <div class="activity-actions">
        <span class="activity-status">Stored</span>
        ${scanLabel ? `<span class="activity-status scan-status ${scanClass}">${scanLabel}</span>` : ""}
        <button class="ghost receipt-download" type="button">Receipt</button>
        <button class="ghost danger delete-upload" type="button">Delete</button>
      </div>
    `;
    activityList.appendChild(row);
  });
  return { hasUploads, hasAny: true };
};

const updateAuthStatus = async (context) => {
  if (!supabase || !authStatus || !context?.usernameKey) return false;
  const [authResult, hiddenPaths] = await Promise.all([
    supabase.storage
      .from(config.supabaseBucket)
      .list(`authorizations/${context.usernameKey}`, { limit: 6, sortBy: { column: "created_at", order: "desc" } }),
    fetchHiddenPaths(context.user?.id),
  ]);

  if (authResult.error || !authResult.data || authResult.data.length === 0) {
    authStatus.textContent = "Required";
    authStatus.className = "status-badge required";
    if (authHeaderBadge) {
      authHeaderBadge.textContent = "Form 8879 required";
      authHeaderBadge.className = "status-badge required";
    }
    if (authOverviewValue) {
      authOverviewValue.textContent = "Form 8879 required";
    }
    if (authOverviewNote) {
      authOverviewNote.textContent = "Upload once signed to authorize e-file.";
    }
    checklistState.authorization = false;
    updateChecklistUI();
    return false;
  }

  const hasVisible = authResult.data.some(
    (item) => !hiddenPaths.has(`authorizations/${context.usernameKey}/${item.name}`)
  );
  if (!hasVisible) {
    authStatus.textContent = "Required";
    authStatus.className = "status-badge required";
    if (authHeaderBadge) {
      authHeaderBadge.textContent = "Form 8879 required";
      authHeaderBadge.className = "status-badge required";
    }
    if (authOverviewValue) {
      authOverviewValue.textContent = "Form 8879 required";
    }
    if (authOverviewNote) {
      authOverviewNote.textContent = "Upload once signed to authorize e-file.";
    }
    checklistState.authorization = false;
    updateChecklistUI();
    return false;
  }

  authStatus.textContent = "Received";
  authStatus.className = "status-badge received";
  if (authHeaderBadge) {
    authHeaderBadge.textContent = "Form 8879 received";
    authHeaderBadge.className = "status-badge received";
  }
  if (authOverviewValue) {
    authOverviewValue.textContent = "Form 8879 received";
  }
  if (authOverviewNote) {
    authOverviewNote.textContent = "Authorization on file for e-file.";
  }
  checklistState.authorization = true;
  updateChecklistUI();
  return true;
};

const loadIntakeStatus = async (user) => {
  if (!user) return;
  try {
    const params = new URLSearchParams();
    if (user.id) params.set("client_user_id", user.id);
    if (user.email) params.set("email", user.email);
    const response = await fetch(`/api/intake/status?${params.toString()}`);
    if (!response.ok) {
      setReviewStatus("received", "Unable to load review status yet.", "", "");
      checklistState.intake = false;
      updateChecklistUI();
      if (metricVaultStatus) {
        metricVaultStatus.textContent = "Unavailable";
      }
      if (metricVaultStatusNote) {
        metricVaultStatusNote.textContent = "Review status could not be loaded yet.";
      }
      setMetricActive(metricVaultStatusCard, false);
      return;
    }
    const data = await response.json();
    if (!data || !data.found) {
      setReviewStatus("received", "Awaiting your most recent secure intake submission.", "", "");
      checklistState.intake = false;
      updateChecklistUI();
      updateRefundDisplay(null);
      if (metricFilingYear) {
        metricFilingYear.textContent = "Not provided";
      }
      if (metricFilingYearNote) {
        metricFilingYearNote.textContent = "Filing year will appear after intake.";
      }
      if (metricVaultStatus) {
        metricVaultStatus.textContent = "Awaiting intake";
      }
      if (metricVaultStatusNote) {
        metricVaultStatusNote.textContent = "Submit secure intake to activate the vault.";
      }
      setMetricActive(metricFilingYearCard, false);
      setMetricActive(metricVaultStatusCard, false);
      return;
    }
    const updated = data.review_updated_at
      ? new Date(data.review_updated_at).toLocaleString()
      : "";
    setReviewStatus(data.review_status, data.review_detail, data.review_notes, updated);
    checklistState.intake = true;
    updateChecklistUI();
    updateRefundDisplay(data);
    if (metricFilingYear && data.filing_year) {
      metricFilingYear.textContent = String(data.filing_year);
    }
    if (metricFilingYearNote) {
      metricFilingYearNote.textContent = "Current tax year selection.";
    }
    setMetricActive(metricFilingYearCard, Boolean(data.filing_year));
    if (metricVaultStatus) {
      const vaultStatus = vaultStatusMap[data.review_status] || vaultStatusMap.received;
      metricVaultStatus.textContent = vaultStatus.label;
      if (metricVaultStatusNote) {
        metricVaultStatusNote.textContent = vaultStatus.note;
      }
    }
    setMetricActive(metricVaultStatusCard, true);
  } catch (error) {
    setReviewStatus("received", "Unable to load review status yet.", "", "");
    checklistState.intake = false;
    updateChecklistUI();
  }
};

const resolveSelectedFiles = (overrideFiles) => {
  if (overrideFiles && overrideFiles.length) {
    return Array.from(overrideFiles);
  }
  if (selectedFiles.length) {
    return selectedFiles;
  }
  return Array.from(uploadInput?.files || []);
};

const uploadFiles = async (context, overrideFiles) => {
  if (!uploadMessage) return;
  if (!context?.usernameKey) {
    setMessage(uploadMessage, "Username missing. Complete account setup to upload files.", "error");
    return;
  }
  const files = resolveSelectedFiles(overrideFiles);
  if (!files.length) {
    setMessage(uploadMessage, "Select files to upload.", "error");
    return;
  }

  const invalidName = files.find((file) => getDocumentNameError(file));
  if (invalidName) {
    setMessage(uploadMessage, getDocumentNameError(invalidName), "error");
    setProgress(uploadProgress, "");
    return;
  }

  setReceipt(uploadReceipt, "", "");
  setProgress(uploadProgress, `Preparing ${files.length} file${files.length > 1 ? "s" : ""}...`);

  const invalid = files.find((file) => !allowedTypes.includes(file.type) || file.size > maxUploadSize);
  if (invalid) {
    setMessage(uploadMessage, `Unsupported file or size too large: ${invalid.name}`, "error");
    setProgress(uploadProgress, "");
    return;
  }

  const scanResult = await scanFiles(files, (message) => setProgress(uploadProgress, message));
  if (!scanResult.ok) {
    setMessage(uploadMessage, scanResult.message || "Upload blocked by security screening.", "error");
    setProgress(uploadProgress, "");
    return;
  }

  setMessage(uploadMessage, "Uploading files...", "info");

  let counter = 0;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const scanInfo = scanResult.results?.[index];
    const scanStatus = scanInfo ? (scanInfo.dlp ? "flagged" : "clean") : "unknown";
    const scanNotes = scanInfo?.message || "";
    const dlpHits = scanInfo?.dlp ? 1 : 0;
    counter += 1;
    setProgress(uploadProgress, `Uploading ${counter} of ${files.length}: ${file.name}`);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const suffix = files.length > 1 ? `-${counter}` : "";
    const path = `uploads/${context.usernameKey}/${buildTimestamp()}${suffix}-${safeName}`;
    const { error } = await supabase.storage
      .from(config.supabaseBucket)
      .upload(path, file, { contentType: file.type, upsert: false });

    if (error) {
      setMessage(uploadMessage, `Upload failed: ${error.message || file.name}`, "error");
      setProgress(uploadProgress, "");
      return;
    }

    await recordUpload({
      client_user_id: context.user?.id || null,
      client_username: context.username,
      file_name: file.name,
      storage_path: path,
      file_size: file.size,
      file_type: file.type,
      category: "documents",
      scan_status: scanStatus,
      scan_notes: scanNotes,
      dlp_hits: dlpHits,
    });
  }

  if (uploadInput) {
    uploadInput.value = "";
  }
  selectedFiles = [];
  if (scanResult.dlpHits) {
    setMessage(
      uploadMessage,
      "Uploads complete. Sensitive data was detected and flagged for preparer review.",
      "warning"
    );
  } else {
    setMessage(uploadMessage, "Uploads complete.", "success");
  }
  setProgress(uploadProgress, "");
  const receiptId = `ASTA-${Date.now().toString(36).toUpperCase()}`;
  setReceipt(
    uploadReceipt,
    receiptId,
    `${files.length} file${files.length > 1 ? "s" : ""} uploaded • ${new Date().toLocaleString()}`
  );
  await listUploads(context);
};

const uploadAuthForm = async (context) => {
  if (!authUploadInput || !authUploadMessage) return;
  if (!context?.usernameKey) {
    setMessage(authUploadMessage, "Username missing. Complete account setup to upload Form 8879.", "error");
    return;
  }
  const file = authUploadInput.files?.[0];
  if (!file) {
    setMessage(authUploadMessage, "Select the signed Form 8879 file.", "error");
    return;
  }

  setReceipt(authUploadReceipt, "", "");
  setProgress(authUploadProgress, `Uploading ${file.name}...`);

  if (!allowedTypes.includes(file.type) || file.size > maxUploadSize) {
    setMessage(authUploadMessage, "Unsupported file type or size exceeds limit.", "error");
    setProgress(authUploadProgress, "");
    return;
  }

  if (!fileNameMatches(file.name, ["8879"])) {
    setMessage(
      authUploadMessage,
      "Rename the authorization file to include 8879 (e.g., Form_8879.pdf) and reselect it.",
      "error"
    );
    setProgress(authUploadProgress, "");
    return;
  }

  const scanResult = await scanFiles([file], (message) => setProgress(authUploadProgress, message));
  if (!scanResult.ok) {
    setMessage(authUploadMessage, scanResult.message || "Upload blocked by security screening.", "error");
    setProgress(authUploadProgress, "");
    return;
  }
  const scanInfo = scanResult.results?.[0];
  const scanStatus = scanInfo ? (scanInfo.dlp ? "flagged" : "clean") : "unknown";
  const scanNotes = scanInfo?.message || "";
  const dlpHits = scanInfo?.dlp ? 1 : 0;

  setMessage(authUploadMessage, "Uploading authorization form...", "info");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `authorizations/${context.usernameKey}/${buildTimestamp()}-${safeName}`;
  const { error } = await supabase.storage
    .from(config.supabaseBucket)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) {
    setMessage(authUploadMessage, `Authorization upload failed: ${error.message || "try again."}`, "error");
    setProgress(authUploadProgress, "");
    return;
  }

  await recordUpload({
    client_user_id: context.user?.id || null,
    client_username: context.username,
    file_name: file.name,
    storage_path: path,
    file_size: file.size,
    file_type: file.type,
    category: "authorizations",
    scan_status: scanStatus,
    scan_notes: scanNotes,
    dlp_hits: dlpHits,
  });

  authUploadInput.value = "";
  if (scanResult.dlpHits) {
    setMessage(
      authUploadMessage,
      "Authorization form received. Sensitive data was detected and flagged for review.",
      "warning"
    );
  } else {
    setMessage(authUploadMessage, "Authorization form received.", "success");
  }
  setProgress(authUploadProgress, "");
  const receiptId = `ASTA-${Date.now().toString(36).toUpperCase()}`;
  setReceipt(authUploadReceipt, receiptId, `Form 8879 received • ${new Date().toLocaleString()}`);
  await updateAuthStatus(context);
};

const init = async () => {
  if (!supabase) return;
  const context = await getUserContext();
  if (!context?.user) {
    setMessage(uploadMessage, "Please sign in to upload documents.", "error");
    setMessage(authUploadMessage, "Please sign in to upload Form 8879.", "error");
    return;
  }
  if (!context.usernameKey) {
    setMessage(uploadMessage, "Complete account setup to enable uploads.", "error");
    setMessage(authUploadMessage, "Complete account setup to enable uploads.", "error");
    uploadButton?.setAttribute("disabled", "true");
    authUploadButton?.setAttribute("disabled", "true");
    return;
  }
  checklistState.profile = true;
  updateChecklistUI();

  setMetricSkeletons(true);
  try {
    await Promise.all([listUploads(context), updateAuthStatus(context), loadIntakeStatus(context.user)]);
  } finally {
    setMetricSkeletons(false);
  }

  uploadButton?.addEventListener("click", () => uploadFiles(context));
  authUploadButton?.addEventListener("click", () => uploadAuthForm(context));

  const handleDrop = (event) => {
    event.preventDefault();
    uploadDrop?.classList.remove("is-dragging");
    const droppedFiles = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    if (!droppedFiles.length) {
      setMessage(uploadMessage, "No files detected in drop.", "error");
      return;
    }
    selectedFiles = droppedFiles;
    uploadFiles(context, droppedFiles);
  };

  if (uploadDrop && uploadInput) {
    uploadDrop.addEventListener("click", (event) => {
      if (event.target === uploadInput) return;
      uploadInput.click();
    });
    uploadInput.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    uploadInput.addEventListener("change", () => {
      selectedFiles = Array.from(uploadInput.files || []);
      if (!selectedFiles.length) return;
      const label = selectedFiles.length === 1 ? "file" : "files";
      setMessage(uploadMessage, `${selectedFiles.length} ${label} selected.`, "info");
      setProgress(uploadProgress, "");
    });
    uploadDrop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        uploadInput.click();
      }
    });
    uploadDrop.addEventListener("dragover", (event) => {
      event.preventDefault();
      uploadDrop.classList.add("is-dragging");
    });
    uploadDrop.addEventListener("dragleave", () => {
      uploadDrop.classList.remove("is-dragging");
    });
    uploadDrop.addEventListener("drop", handleDrop);
    uploadInput.addEventListener("dragover", (event) => {
      event.preventDefault();
      uploadDrop.classList.add("is-dragging");
    });
    uploadInput.addEventListener("dragleave", () => {
      uploadDrop.classList.remove("is-dragging");
    });
    uploadInput.addEventListener("drop", handleDrop);
  }

  if (activityList) {
    activityList.addEventListener("click", async (event) => {
      const receiptButton = event.target.closest(".receipt-download");
      if (receiptButton) {
        event.stopPropagation();
        const row = event.target.closest(".activity-item");
        if (!row) return;
        const receiptId = `ASTA-${Date.now().toString(36).toUpperCase()}`;
        const createdAt = row.dataset.created
          ? new Date(row.dataset.created).toLocaleString()
          : new Date().toLocaleString();
        const label = row.dataset.label || "Document";
        const name = row.dataset.name || "File";
        const size = row.dataset.size ? formatBytes(Number(row.dataset.size)) : "N/A";
        const receipt = `ASTA Upload Receipt\n\nReceipt ID: ${receiptId}\nDocument: ${name}\nType: ${label}\nSize: ${size}\nUploaded: ${createdAt}\n\nFor questions, contact support@atlassecuretax.com.`;

        const blob = new Blob([receipt], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${receiptId}.txt`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        return;
      }

      const deleteButton = event.target.closest(".delete-upload");
      if (deleteButton) {
        event.stopPropagation();
        const row = event.target.closest(".activity-item");
        if (!row) return;
        const path = row.dataset.path;
        const name = row.dataset.name || "this file";
        if (!path) {
          setMessage(uploadMessage, "Unable to delete this file.", "error");
          return;
        }
        const confirmed = window.confirm(`Remove ${name} from your dashboard? It will remain in ASTA records.`);
        if (!confirmed) return;

        if (!context?.user?.id) {
          setMessage(uploadMessage, "Unable to remove this file right now.", "error");
          return;
        }
        const { error } = await supabase
          .from(hiddenTable)
          .upsert({ user_id: context.user.id, path, hidden: true }, { onConflict: "user_id,path" });
        if (error) {
          setMessage(uploadMessage, `Remove failed: ${error.message || "try again."}`, "error");
          return;
        }
        setMessage(uploadMessage, "File removed from your dashboard.", "success");
        await listUploads(context);
        await updateAuthStatus(context);
        return;
      }

      const row = event.target.closest(".activity-item");
      if (!row || !row.dataset.url) return;
      openViewer({
        url: row.dataset.url,
        name: row.dataset.name,
        label: row.dataset.label,
        type: row.dataset.type,
      });
    });
  }
};

if (viewerClose) {
  viewerClose.addEventListener("click", closeViewer);
}

if (viewerOverlay) {
  viewerOverlay.addEventListener("click", (event) => {
    if (event.target === viewerOverlay) {
      closeViewer();
    }
  });
}

const getFocusableElements = () => {
  if (!viewerOverlay) return [];
  return Array.from(
    viewerOverlay.querySelectorAll(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    )
  );
};

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeViewer();
    return;
  }
  if (event.key === "Tab" && focusTrapEnabled) {
    const focusable = getFocusableElements();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

init();
