import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { scanFiles } from "./upload-security.js";

const config = window.APP_CONFIG || {};
const storageEnabled = Boolean(
  config.supabaseUrl && config.supabaseAnonKey && config.supabaseBucket
);
const supabase = storageEnabled ? createClient(config.supabaseUrl, config.supabaseAnonKey) : null;
const allowedTypes = config.allowedFileTypes || ["application/pdf", "image/jpeg", "image/png"];
const maxUploadSize = (config.maxUploadSizeMb || 10) * 1024 * 1024;
const normalizeUsername = (value) =>
  value ? value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "_") : "";
const buildTimestamp = () => new Date().toISOString().replace(/[-:.TZ]/g, "");
let allowResubmit = false;
let editingIntakeId = null;
let rawSsn = "";
let syncMaskedValue = () => {};
let storedDob = "";
let ssnMasked = false;
let ipPinMasked = false;

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

const scrollButtons = document.querySelectorAll("[data-scroll]");
scrollButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.getAttribute("data-scroll");
    if (!target) return;
    const section = document.querySelector(target);
    if (section) {
      section.scrollIntoView({ behavior: "smooth" });
    }
  });
});

const form = document.getElementById("intake-form");
const formMessage = form ? form.querySelector(".form-message") : null;
const ssnInput = form ? form.querySelector('input[name="ssn"]') : null;
const ipPinInput = form ? form.querySelector('input[name="ip_pin"]') : null;
const dobInput = form ? form.querySelector('input[name="dob"]') : null;
const intakeFileInputs = form ? Array.from(form.querySelectorAll('input[type="file"]')) : [];
const intakeLocked = document.getElementById("intake-locked");
const intakeLockDate = document.getElementById("intake-lock-date");
const intakeLockYear = document.getElementById("intake-lock-year");
const intakeNav = document.getElementById("intake-nav");
const intakeCta = document.getElementById("intake-cta");
const intakeUpdateButton = document.getElementById("intake-update");
const intakeCancelButton = document.getElementById("intake-cancel");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const requiredSelector = "input[required], select[required], textarea[required]";
const estimateForm = document.getElementById("estimate-form");
const estimateTaxable = document.getElementById("estimate-taxable");
const estimateTax = document.getElementById("estimate-tax");
const estimateWithheld = document.getElementById("estimate-withheld");
const estimateResult = document.getElementById("estimate-result");
const estimateNote = document.getElementById("estimate-note");
const intakeEstimateValue = document.getElementById("intake-estimate-value");
const intakeEstimateNote = document.getElementById("intake-estimate-note");
const intakeReceipt = document.getElementById("intake-receipt");
const fileNameRules = {
  w2_upload: {
    label: "W-2 or 1099 forms",
    tokens: ["w2", "w-2", "1099"],
    display: ["W-2", "1099"],
    example: "W-2_2025.pdf",
  },
  mortgage_upload: {
    label: "1098 mortgage statement",
    tokens: ["1098", "mortgage"],
    display: ["1098", "Mortgage"],
    example: "1098_Mortgage_2025.pdf",
  },
  id_upload: {
    label: "Photo ID",
    tokens: ["photoid", "photo", "id", "passport", "driverlicense", "driver", "license"],
    display: ["Photo ID", "Passport", "Driver_License"],
    example: "Photo_ID.pdf",
  },
};

const normalizeFileName = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const matchesFileNameTokens = (fileName, tokens) => {
  const normalized = normalizeFileName(fileName);
  return tokens.some((token) => normalized.includes(normalizeFileName(token)));
};

const getFileNameError = (input) => {
  if (!input || input.type !== "file") return "";
  const rule = fileNameRules[input.name];
  if (!rule) return "";
  const files = Array.from(input.files || []);
  if (!files.length) return "";
  const invalid = files.find((file) => !matchesFileNameTokens(file.name, rule.tokens));
  if (!invalid) return "";
  const expected = rule.display.join(" or ");
  return `Rename the ${rule.label} file to include ${expected}. Example: ${rule.example}.`;
};

function updateProgress() {
  if (!form || !progressBar || !progressText) return;

  const requiredFields = Array.from(form.querySelectorAll(requiredSelector));
  const filled = requiredFields.filter((field) => {
    if (field.type === "checkbox") return field.checked;
    if (field.type === "file") return field.files && field.files.length > 0;
    return field.value && field.value.trim().length > 0;
  });

  const percent = requiredFields.length
    ? Math.round((filled.length / requiredFields.length) * 100)
    : 0;

  progressBar.style.width = `${percent}%`;
  progressText.textContent = `${percent}% complete`;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const taxConfig = {
  "2025": {
    standardDeduction: {
      single: 15750,
      married_joint: 31500,
      married_separate: 15750,
      head_household: 23625,
    },
    brackets: {
      single: [
        [11925, 0.1],
        [48475, 0.12],
        [103350, 0.22],
        [197300, 0.24],
        [250525, 0.32],
        [626350, 0.35],
        [Infinity, 0.37],
      ],
      married_joint: [
        [23850, 0.1],
        [96950, 0.12],
        [206700, 0.22],
        [394600, 0.24],
        [501050, 0.32],
        [751600, 0.35],
        [Infinity, 0.37],
      ],
      married_separate: [
        [11925, 0.1],
        [48475, 0.12],
        [103350, 0.22],
        [197300, 0.24],
        [250525, 0.32],
        [375800, 0.35],
        [Infinity, 0.37],
      ],
      head_household: [
        [17000, 0.1],
        [64850, 0.12],
        [103350, 0.22],
        [197300, 0.24],
        [250500, 0.32],
        [626350, 0.35],
        [Infinity, 0.37],
      ],
    },
    note: "Based on 2025 federal brackets and standard deduction.",
  },
  "2024": {
    standardDeduction: {
      single: 14600,
      married_joint: 29200,
      married_separate: 14600,
      head_household: 21900,
    },
    brackets: {
      single: [
        [11600, 0.1],
        [47150, 0.12],
        [100525, 0.22],
        [191950, 0.24],
        [243725, 0.32],
        [609350, 0.35],
        [Infinity, 0.37],
      ],
      married_joint: [
        [23200, 0.1],
        [94300, 0.12],
        [201050, 0.22],
        [383900, 0.24],
        [487450, 0.32],
        [731200, 0.35],
        [Infinity, 0.37],
      ],
      married_separate: [
        [11600, 0.1],
        [47150, 0.12],
        [100525, 0.22],
        [191950, 0.24],
        [243725, 0.32],
        [365600, 0.35],
        [Infinity, 0.37],
      ],
      head_household: [
        [16550, 0.1],
        [63100, 0.12],
        [100500, 0.22],
        [191950, 0.24],
        [243700, 0.32],
        [609350, 0.35],
        [Infinity, 0.37],
      ],
    },
  },
  "2022": {
    standardDeduction: {
      single: 12950,
      married_joint: 25900,
      married_separate: 12950,
      head_household: 19400,
    },
    brackets: {
      single: [
        [10275, 0.1],
        [41775, 0.12],
        [89075, 0.22],
        [170050, 0.24],
        [215950, 0.32],
        [539900, 0.35],
        [Infinity, 0.37],
      ],
      married_joint: [
        [20550, 0.1],
        [83550, 0.12],
        [178150, 0.22],
        [340100, 0.24],
        [431900, 0.32],
        [647850, 0.35],
        [Infinity, 0.37],
      ],
      married_separate: [
        [10275, 0.1],
        [41775, 0.12],
        [89075, 0.22],
        [170050, 0.24],
        [215950, 0.32],
        [323925, 0.35],
        [Infinity, 0.37],
      ],
      head_household: [
        [14650, 0.1],
        [55900, 0.12],
        [89050, 0.22],
        [170050, 0.24],
        [215950, 0.32],
        [539900, 0.35],
        [Infinity, 0.37],
      ],
    },
  },
  "2023": {
    standardDeduction: {
      single: 13850,
      married_joint: 27700,
      married_separate: 13850,
      head_household: 20800,
    },
    brackets: {
      single: [
        [11000, 0.1],
        [44725, 0.12],
        [95375, 0.22],
        [182100, 0.24],
        [231250, 0.32],
        [578125, 0.35],
        [Infinity, 0.37],
      ],
      married_joint: [
        [22000, 0.1],
        [89450, 0.12],
        [190750, 0.22],
        [364200, 0.24],
        [462500, 0.32],
        [693750, 0.35],
        [Infinity, 0.37],
      ],
      married_separate: [
        [11000, 0.1],
        [44725, 0.12],
        [95375, 0.22],
        [182100, 0.24],
        [231250, 0.32],
        [346875, 0.35],
        [Infinity, 0.37],
      ],
      head_household: [
        [15700, 0.1],
        [59850, 0.12],
        [95350, 0.22],
        [182100, 0.24],
        [231250, 0.32],
        [578100, 0.35],
        [Infinity, 0.37],
      ],
    },
  },
};

const toAmount = (value) => {
  if (value === undefined || value === null) return 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  if (!cleaned) return 0;
  const num = Number.parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
};

const computeTax = (income, brackets) => {
  if (!brackets || income <= 0) return 0;
  let tax = 0;
  let lastCap = 0;
  brackets.forEach(([cap, rate]) => {
    if (income <= lastCap) return;
    const taxableAtRate = Math.min(income, cap) - lastCap;
    tax += taxableAtRate * rate;
    lastCap = cap;
  });
  return tax;
};

const collectUploadFiles = (formEl) => {
  if (!formEl) return [];
  const inputs = Array.from(formEl.querySelectorAll('input[type="file"]'));
  return inputs.flatMap((input) => {
    const label =
      input.closest("label")?.querySelector("span")?.textContent?.trim() || "Document";
    return Array.from(input.files || []).map((file) => ({ file, label }));
  });
};

const uploadIntakeDocuments = async (files, statusEl, userContext) => {
  if (!files.length) return { ok: true, uploaded: 0, dlpHits: 0 };
  if (!supabase || !storageEnabled) {
    return {
      ok: false,
      message: "Document upload is unavailable. Please upload files in the client dashboard.",
    };
  }

  const context = userContext || (await getUserContext());
  if (!context?.user) {
    return {
      ok: false,
      message: "Session expired. Please sign in again to upload documents.",
    };
  }
  if (!context.usernameKey) {
    return {
      ok: false,
      message: "Username missing. Please complete account setup before uploading documents.",
    };
  }

  const invalid = files.find(({ file }) => !allowedTypes.includes(file.type) || file.size > maxUploadSize);
  if (invalid) {
    return {
      ok: false,
      message: `Unsupported file or size too large: ${invalid.file.name}`,
    };
  }

  const scanResult = await scanFiles(files.map((item) => item.file), (message) => {
    if (statusEl && message) {
      statusEl.classList.remove("is-error");
      statusEl.classList.add("is-success");
      statusEl.textContent = message;
    }
  });
  if (!scanResult.ok) {
    return {
      ok: false,
      message: scanResult.message || "Document upload blocked by security screening.",
    };
  }

  let counter = 0;
  for (let index = 0; index < files.length; index += 1) {
    const item = files[index];
    counter += 1;
    if (statusEl) {
      statusEl.classList.remove("is-error");
      statusEl.classList.add("is-success");
      statusEl.textContent = `Uploading ${item.label} (${counter} of ${files.length})...`;
    }
    const safeName = item.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const suffix = files.length > 1 ? `-${counter}` : "";
    const path = `uploads/${context.usernameKey}/${buildTimestamp()}${suffix}-${safeName}`;
    const { error } = await supabase.storage
      .from(config.supabaseBucket)
      .upload(path, item.file, { contentType: item.file.type, upsert: false });

    if (error) {
      return {
        ok: false,
        message: `Document upload failed for ${item.file.name}. Please retry in the dashboard.`,
      };
    }

    const scanInfo = scanResult.results?.[index];
    const scanStatus = scanInfo ? (scanInfo.dlp ? "flagged" : "clean") : "unknown";
    const scanNotes = scanInfo?.message || "";
    const dlpHits = scanInfo?.dlp ? 1 : 0;
    await recordUpload({
      client_user_id: context.user.id,
      client_username: context.username,
      file_name: item.file.name,
      storage_path: path,
      file_size: item.file.size,
      file_type: item.file.type,
      category: "documents",
      document_label: item.label,
      scan_status: scanStatus,
      scan_notes: scanNotes,
      dlp_hits: dlpHits,
    });
  }

  return { ok: true, uploaded: files.length, dlpHits: scanResult.dlpHits || 0 };
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

const updateEstimate = () => {
  if (!estimateForm || !estimateTaxable || !estimateTax || !estimateWithheld || !estimateResult) return;

  const year = estimateForm.querySelector("#estimate-year")?.value;
  const status = estimateForm.querySelector("#estimate-status")?.value;
  if (!year || !status) {
    estimateTaxable.textContent = currencyFormatter.format(0);
    estimateTax.textContent = currencyFormatter.format(0);
    estimateWithheld.textContent = currencyFormatter.format(0);
    estimateResult.textContent = "Select filing year and status to estimate.";
    estimateResult.classList.remove("is-due");
    if (estimateNote) {
      estimateNote.textContent = "Based on federal brackets for the selected year.";
    }
    return;
  }

  const config = taxConfig[year];
  if (!config) {
    estimateTaxable.textContent = currencyFormatter.format(0);
    estimateTax.textContent = currencyFormatter.format(0);
    estimateWithheld.textContent = currencyFormatter.format(0);
    estimateResult.textContent = `Estimator not yet available for ${year}.`;
    estimateResult.classList.remove("is-due");
    if (estimateNote) {
      estimateNote.textContent = "Based on federal brackets for the selected year.";
    }
    return;
  }

  const totalIncome =
    toAmount(estimateForm.querySelector("#estimate-wages")?.value) +
    toAmount(estimateForm.querySelector("#estimate-1099")?.value) +
    toAmount(estimateForm.querySelector("#estimate-investment")?.value) +
    toAmount(estimateForm.querySelector("#estimate-retirement")?.value) +
    toAmount(estimateForm.querySelector("#estimate-other-income")?.value);

  const mortgage = toAmount(estimateForm.querySelector("#estimate-mortgage")?.value);
  const charity = toAmount(estimateForm.querySelector("#estimate-charity")?.value);
  const studentLoan = toAmount(estimateForm.querySelector("#estimate-student-loan")?.value);
  const hsa = toAmount(estimateForm.querySelector("#estimate-hsa")?.value);

  const itemized = mortgage + charity + studentLoan;
  const standardDeduction = config.standardDeduction[status] || 0;
  const deduction = Math.max(standardDeduction, itemized);
  const taxableIncome = Math.max(0, totalIncome - hsa - deduction);
  const estimatedTax = computeTax(taxableIncome, config.brackets[status]);
  const withheld = toAmount(estimateForm.querySelector("#estimate-withholding")?.value);
  const refund = withheld - estimatedTax;

  estimateTaxable.textContent = currencyFormatter.format(Math.round(taxableIncome));
  estimateTax.textContent = currencyFormatter.format(Math.round(estimatedTax));
  estimateWithheld.textContent = currencyFormatter.format(Math.round(withheld));

  if (refund >= 0) {
    estimateResult.textContent = `Estimated refund: ${currencyFormatter.format(Math.round(refund))}`;
    estimateResult.classList.remove("is-due");
  } else {
    estimateResult.textContent = `Estimated amount due: ${currencyFormatter.format(Math.round(Math.abs(refund)))}`;
    estimateResult.classList.add("is-due");
  }

  if (estimateNote) {
    estimateNote.textContent = config.note || `Based on ${year} federal brackets and standard deduction.`;
  }
};

const updateIntakeEstimate = () => {
  if (!form || !intakeEstimateValue || !intakeEstimateNote) return;
  const year = form.querySelector('select[name="filing_year"]')?.value;
  const status = form.querySelector('select[name="filing_status"]')?.value;
  const config = taxConfig[year];

  const wages = toAmount(form.querySelector('input[name="wages"]')?.value);
  const income1099 = toAmount(form.querySelector('input[name="income_1099"]')?.value);
  const investment = toAmount(form.querySelector('input[name="investment_income"]')?.value);
  const retirement = toAmount(form.querySelector('input[name="retirement"]')?.value);
  const mortgage = toAmount(form.querySelector('input[name="mortgage"]')?.value);
  const charity = toAmount(form.querySelector('input[name="charity"]')?.value);
  const studentLoan = toAmount(form.querySelector('input[name="student_loan"]')?.value);
  const hsa = toAmount(form.querySelector('input[name="hsa"]')?.value);
  const withheld = toAmount(form.querySelector('input[name="federal_withholding"]')?.value);

  const totalIncome = wages + income1099 + investment + retirement;
  const hasInputs = totalIncome > 0 || withheld > 0 || mortgage > 0 || charity > 0 || studentLoan > 0 || hsa > 0;

  if (!year || !status) {
    intakeEstimateValue.textContent = "Estimate pending";
    intakeEstimateValue.classList.remove("is-positive", "is-negative");
    intakeEstimateNote.textContent = "Select filing year and status to calculate an estimate.";
    return;
  }

  if (!config || !config.brackets?.[status]) {
    intakeEstimateValue.textContent = "Estimate pending";
    intakeEstimateValue.classList.remove("is-positive", "is-negative");
    intakeEstimateNote.textContent = `Estimator not available for ${year} yet.`;
    return;
  }

  if (!hasInputs) {
    intakeEstimateValue.textContent = "Estimate pending";
    intakeEstimateValue.classList.remove("is-positive", "is-negative");
    intakeEstimateNote.textContent = "Add income and withholding to see a live estimate.";
    return;
  }

  const itemized = mortgage + charity + studentLoan;
  const standardDeduction = config.standardDeduction[status] || 0;
  const deduction = Math.max(standardDeduction, itemized);
  const taxableIncome = Math.max(0, totalIncome - hsa - deduction);
  const estimatedTax = computeTax(taxableIncome, config.brackets[status]);
  const refund = withheld - estimatedTax;
  const rounded = Math.round(Math.abs(refund));

  if (refund >= 0) {
    intakeEstimateValue.textContent = `Estimated refund: ${currencyFormatter.format(rounded)}`;
    intakeEstimateValue.classList.add("is-positive");
    intakeEstimateValue.classList.remove("is-negative");
  } else {
    intakeEstimateValue.textContent = `Estimated amount due: ${currencyFormatter.format(rounded)}`;
    intakeEstimateValue.classList.add("is-negative");
    intakeEstimateValue.classList.remove("is-positive");
  }
  intakeEstimateNote.textContent = config.note || `Based on ${year} federal brackets and standard deduction.`;
};

const markRequiredState = (field) => {
  if (!field || field.dataset.required !== undefined) return;
  field.dataset.required = field.required ? "true" : "false";
};

const setFieldHint = (field, hintId, text) => {
  if (!field) return;
  const label = field.closest("label");
  if (!label) return;
  let hint = label.querySelector(`[data-hint="${hintId}"]`);
  if (!text) {
    if (hint) hint.remove();
    return;
  }
  if (!hint) {
    hint = document.createElement("small");
    hint.className = "field-hint";
    hint.dataset.hint = hintId;
    label.appendChild(hint);
  }
  hint.textContent = text;
};

const setEditingState = (isEditing) => {
  allowResubmit = isEditing;
  if (form) {
    form.classList.toggle("is-editing", isEditing);
  }
  if (intakeCancelButton) {
    intakeCancelButton.hidden = !isEditing;
  }

  markRequiredState(ssnInput);
  markRequiredState(ipPinInput);
  markRequiredState(dobInput);
  intakeFileInputs.forEach((input) => markRequiredState(input));

  if (ssnInput) {
    ssnInput.required = !isEditing;
    ssnInput.placeholder = isEditing ? "*********" : "XXX-XX-XXXX";
    setFieldHint(ssnInput, "ssn-mask", isEditing ? "On file: *********" : "");
    if (isEditing) {
      ssnMasked = true;
      ssnInput.value = "*********";
    } else {
      ssnMasked = false;
    }
  }
  if (ipPinInput) {
    ipPinInput.required = !isEditing;
    ipPinInput.placeholder = isEditing ? "••••••" : "••••••";
    setFieldHint(ipPinInput, "ip-pin-mask", isEditing ? "On file: ••••••" : "");
    if (isEditing) {
      ipPinMasked = true;
      ipPinInput.value = "••••••";
    } else {
      ipPinMasked = false;
    }
  }
  if (dobInput) {
    dobInput.required = !isEditing;
    setFieldHint(dobInput, "dob-mask", isEditing ? "On file: ****-**-** (click to edit)" : "");
    if (isEditing && storedDob) {
      dobInput.type = "text";
      dobInput.value = "****-**-**";
    } else {
      dobInput.type = "date";
    }
  }

  intakeFileInputs.forEach((input) => {
    input.required = !isEditing && input.dataset.required === "true";
    if (isEditing) {
      setFieldHint(input, `file-${input.name}`, "Existing uploads remain. Add new files only if needed.");
    } else {
      setFieldHint(input, `file-${input.name}`, "");
    }
  });

  if (!isEditing) {
    editingIntakeId = null;
    storedDob = "";
    ssnMasked = false;
    ipPinMasked = false;
    if (dobInput) {
      dobInput.type = "date";
    }
  }
};

const populateIntakeForm = (data) => {
  if (!form || !data) return;
  const setValue = (selector, value) => {
    const field = form.querySelector(selector);
    if (!field) return;
    field.value = value ?? "";
  };
  setValue('input[name="first_name"]', data.first_name);
  setValue('input[name="last_name"]', data.last_name);
  setValue('input[name="dob"]', data.dob);
  storedDob = data.dob || "";
  setValue('input[name="email"]', data.email);
  setValue('input[name="phone"]', data.phone);
  setValue('input[name="employer"]', data.employer);
  setValue('input[name="wages"]', data.wages);
  setValue('input[name="federal_withholding"]', data.federal_withholding);
  setValue('input[name="income_1099"]', data.income_1099);
  setValue('input[name="investment_income"]', data.investment_income);
  setValue('input[name="retirement"]', data.retirement);
  setValue('input[name="other_income"]', data.other_income);
  setValue('input[name="mortgage"]', data.mortgage);
  setValue('input[name="charity"]', data.charity);
  setValue('input[name="student_loan"]', data.student_loan);
  setValue('input[name="dependents"]', data.dependents);
  setValue('input[name="hsa"]', data.hsa);
  setValue('input[name="other_deductions"]', data.other_deductions);
  setValue('select[name="filing_year"]', data.filing_year);
  setValue('select[name="filing_status"]', data.filing_status);
  setValue('select[name="filing_method"]', data.filing_method);
  setValue('select[name="contact_method"]', data.contact_method);
  setValue('textarea[name="notes"]', data.notes);
  const consentField = form.querySelector('input[name="consent"]');
  if (consentField) {
    consentField.checked = Boolean(data.consent);
  }
  intakeFileInputs.forEach((input) => {
    input.value = "";
  });
  rawSsn = "";
  syncMaskedValue();
  if (ipPinInput) {
    ipPinInput.value = "";
  }
  updateProgress();
  updateIntakeEstimate();
};

const loadIntakeForEdit = async () => {
  if (!supabase) {
    if (formMessage) {
      formMessage.classList.add("is-error");
      formMessage.textContent = "Sign in to edit your secure intake.";
    }
    return;
  }
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      if (formMessage) {
        formMessage.classList.add("is-error");
        formMessage.textContent = "Sign in to edit your secure intake.";
      }
      return;
    }
    const response = await fetch("/api/intake/latest", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error("Unable to load your secure intake.");
    }
    const result = await response.json();
    if (!result?.found || !result?.intake) {
      throw new Error("No secure intake found to edit.");
    }
    editingIntakeId = result.intake.id;
    populateIntakeForm(result.intake);
    setEditingState(true);
    if (formMessage) {
      formMessage.classList.remove("is-error", "is-success");
      formMessage.textContent =
        "Editing your latest intake. Sensitive fields stay on file unless you change them.";
    }
  } catch (error) {
    if (formMessage) {
      formMessage.classList.add("is-error");
      formMessage.textContent = error.message || "Unable to load your secure intake.";
    }
    setEditingState(false);
    checkExistingIntake();
  }
};

  if (form) {
    const postSubmit = form.querySelector(".post-submit");

    const clearFieldError = (field) => {
    if (!field) return;
    field.classList.remove("is-error");
    const label = field.closest("label");
    if (label) {
      label.classList.remove("is-error");
      const errorEl = label.querySelector(".field-error");
      if (errorEl) errorEl.remove();
    }
  };

  const clearErrors = () => {
    form.querySelectorAll(".is-error").forEach((node) => node.classList.remove("is-error"));
    form.querySelectorAll(".field-error").forEach((node) => node.remove());
    if (formMessage) {
      formMessage.classList.remove("is-error");
      formMessage.classList.remove("is-success");
      formMessage.textContent = "";
    }
    if (intakeReceipt) {
      intakeReceipt.textContent = "";
      intakeReceipt.classList.remove("is-visible");
      }
    };

    const addFieldError = (field, message) => {
      if (!field) return;
      field.classList.add("is-error");
      const label = field.closest("label");
      if (label) {
        label.classList.add("is-error");
        let errorEl = label.querySelector(".field-error");
        if (!errorEl) {
          errorEl = document.createElement("span");
          errorEl.className = "field-error";
          label.appendChild(errorEl);
        }
        errorEl.textContent = message;
      }
    };

    const showErrors = (errors) => {
      if (formMessage) {
        formMessage.classList.remove("is-success");
        formMessage.classList.add("is-error");
        formMessage.innerHTML = "<strong>Please fix the highlighted fields.</strong>";
        if (errors.length) {
          const list = document.createElement("ul");
          errors.forEach(({ message }) => {
            const item = document.createElement("li");
            item.textContent = message;
            list.appendChild(item);
          });
          formMessage.appendChild(list);
        }
      }

      errors.forEach(({ field, message }) => {
        addFieldError(field, message);
      });
    };

    form.addEventListener("input", (event) => {
      updateProgress();
      updateIntakeEstimate();
      if (event.target instanceof HTMLElement) {
        clearFieldError(event.target);
      }
    if (formMessage?.classList.contains("is-success")) {
      formMessage.classList.remove("is-success");
      formMessage.textContent = "";
    }
    if (intakeReceipt?.classList.contains("is-visible")) {
      intakeReceipt.textContent = "";
      intakeReceipt.classList.remove("is-visible");
    }
    });
    form.addEventListener("change", (event) => {
      updateProgress();
      updateIntakeEstimate();
      if (event.target instanceof HTMLElement) {
        clearFieldError(event.target);
      }
      if (event.target instanceof HTMLInputElement && event.target.type === "file") {
        const fileError = getFileNameError(event.target);
        if (fileError) {
          addFieldError(event.target, fileError);
        }
      }
      if (formMessage?.classList.contains("is-success")) {
        formMessage.classList.remove("is-success");
        formMessage.textContent = "";
      }
    if (intakeReceipt?.classList.contains("is-visible")) {
      intakeReceipt.textContent = "";
      intakeReceipt.classList.remove("is-visible");
    }
  });
  updateProgress();
  updateIntakeEstimate();

  if (intakeUpdateButton) {
    intakeUpdateButton.addEventListener("click", () => {
      setIntakeLocked({ locked: false });
      loadIntakeForEdit();
      form?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  if (intakeCancelButton) {
    intakeCancelButton.addEventListener("click", () => {
      setEditingState(false);
      if (form) {
        form.reset();
      }
      rawSsn = "";
      syncMaskedValue();
      updateProgress();
      updateIntakeEstimate();
      checkExistingIntake();
    });
  }

  if (ssnInput) {
    const submitButton = form.querySelector('button[type="submit"]');

    syncMaskedValue = () => {
      ssnInput.value = rawSsn.length ? "*".repeat(rawSsn.length) : "";
    };

    ssnInput.addEventListener("focus", () => {
      if (ssnMasked) {
        ssnMasked = false;
        rawSsn = "";
        ssnInput.value = "";
      }
    });

    ssnInput.addEventListener("keydown", (event) => {
      if (event.key === "Backspace") {
        rawSsn = rawSsn.slice(0, -1);
        syncMaskedValue();
        updateProgress();
        event.preventDefault();
        return;
      }

      if (event.key === "Delete") {
        rawSsn = "";
        syncMaskedValue();
        updateProgress();
        event.preventDefault();
        return;
      }

      if (
        event.key === "Tab" ||
        event.key.startsWith("Arrow") ||
        event.key === "Home" ||
        event.key === "End"
      ) {
        return;
      }

      if (event.key.length === 1) {
        if (/^\d$/.test(event.key)) {
          if (rawSsn.length < 9) {
            rawSsn += event.key;
            syncMaskedValue();
            updateProgress();
          }
          event.preventDefault();
          return;
        }
        event.preventDefault();
      }
    });

    ssnInput.addEventListener("paste", (event) => {
      const clipboard = event.clipboardData?.getData("text") || "";
      rawSsn = clipboard.replace(/\D/g, "").slice(0, 9);
      syncMaskedValue();
      updateProgress();
      event.preventDefault();
    });

    ssnInput.addEventListener("input", (event) => {
      const digits = event.target.value.replace(/\D/g, "");
      if (digits) {
        rawSsn = digits.slice(0, 9);
        syncMaskedValue();
        updateProgress();
      } else if (!rawSsn) {
        syncMaskedValue();
      }
    });

    if (ipPinInput) {
      ipPinInput.addEventListener("focus", () => {
        if (ipPinMasked) {
          ipPinMasked = false;
          ipPinInput.value = "";
        }
      });
      ipPinInput.addEventListener("input", () => {
        ipPinInput.value = ipPinInput.value.replace(/\D/g, "").slice(0, 6);
      });
    }
    if (dobInput) {
      dobInput.addEventListener("focus", () => {
        if (form.classList.contains("is-editing") && dobInput.type === "text") {
          dobInput.type = "date";
          if (storedDob) {
            dobInput.value = storedDob;
          }
        }
      });
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (intakeLocked && intakeLocked.hidden === false && !allowResubmit) {
        return;
      }
      clearErrors();

      const errors = [];
      const requiredFields = Array.from(form.querySelectorAll(requiredSelector));
      requiredFields.forEach((field) => {
        if (field.name === "ssn") return;
        let valid = field.checkValidity();
        if (field.type === "checkbox") valid = field.checked;
        if (field.type === "file") valid = field.files && field.files.length > 0;
        if (!valid) {
          errors.push({
            field,
            message: field.validationMessage || "This field is required.",
          });
        }
      });

      if (rawSsn.length && rawSsn.length !== 9) {
        errors.push({
          field: ssnInput,
          message: "Enter a valid 9-digit SSN.",
        });
      } else if (!editingIntakeId && rawSsn.length !== 9) {
        errors.push({
          field: ssnInput,
          message: "Enter a valid 9-digit SSN.",
        });
      }

      const ipPinValue = ipPinInput ? ipPinInput.value.replace(/\D/g, "").slice(0, 6) : "";
      if (ipPinInput && ipPinValue.length && ipPinValue.length !== 6) {
        errors.push({
          field: ipPinInput,
          message: "Enter the 6-digit IRS IP PIN.",
        });
      } else if (ipPinInput && !editingIntakeId && ipPinValue.length !== 6) {
        errors.push({
          field: ipPinInput,
          message: "Enter the 6-digit IRS IP PIN.",
        });
      }

      if (errors.length) {
        showErrors(errors);
        formMessage?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      const fileInputs = Array.from(form.querySelectorAll('input[type="file"]'));
      fileInputs.forEach((input) => {
        const fileError = getFileNameError(input);
        if (fileError) {
          errors.push({ field: input, message: fileError });
        }
      });

      if (errors.length) {
        showErrors(errors);
        formMessage?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      const filesToUpload = collectUploadFiles(form);
      const userContext = supabase ? await getUserContext() : null;
      const payload = {};
      const formData = new FormData(form);
      formData.forEach((value, key) => {
        if (value instanceof File) return;
        payload[key] = value;
      });
      if (rawSsn.length) {
        payload.ssn = rawSsn;
      }
      if (ipPinInput && ipPinValue.length) {
        payload.ip_pin = ipPinValue;
      }
      if (!payload.dob && storedDob) {
        payload.dob = storedDob;
      }
      if (typeof payload.dob === "string" && payload.dob.includes("*") && storedDob) {
        payload.dob = storedDob;
      }
      payload.consent = form.querySelector('input[name="consent"]')?.checked === true;
      if (userContext?.user?.id) {
        payload.client_user_id = userContext.user.id;
      }
      if (userContext?.username) {
        payload.client_username = userContext.username;
      }
      if (editingIntakeId) {
        payload.intake_id = editingIntakeId;
      }

      const originalText = submitButton?.textContent || "";
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.classList.add("is-busy");
        submitButton.textContent = editingIntakeId ? "Updating..." : "Submitting...";
      }

      try {
        let token = "";
        if (supabase) {
          const sessionData = await supabase.auth.getSession();
          token = sessionData.data.session?.access_token || "";
        }
        if (editingIntakeId && !token) {
          throw new Error("Sign in again to update your secure intake.");
        }
        const response = await fetch("/api/intake", {
          method: editingIntakeId ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          const message = errorBody.error || "Submission failed.";
          const fieldErrors = [];
          if (message.toLowerCase().includes("dependents")) {
            const dependentsField = form.querySelector('input[name="dependents"]');
            fieldErrors.push({ field: dependentsField, message });
          }
          if (message.toLowerCase().includes("ssn")) {
            fieldErrors.push({ field: ssnInput, message });
          }
          if (message.toLowerCase().includes("filing status")) {
            const statusField = form.querySelector('select[name="filing_status"]');
            fieldErrors.push({ field: statusField, message });
          }
          if (message.toLowerCase().includes("filing year")) {
            const yearField = form.querySelector('select[name="filing_year"]');
            fieldErrors.push({ field: yearField, message });
          }
          if (message.toLowerCase().includes("ip pin")) {
            fieldErrors.push({ field: ipPinInput, message });
          }
          if (fieldErrors.length) {
            showErrors(fieldErrors);
          } else {
            showErrors([{ message }]);
          }
          throw new Error(message);
        }

        const uploadResult = await uploadIntakeDocuments(filesToUpload, formMessage, userContext);
        if (formMessage) {
          formMessage.classList.remove("is-error");
          formMessage.classList.add("is-success");
          if (filesToUpload.length && !uploadResult.ok) {
            const detail = uploadResult.message
              ? ` ${uploadResult.message}`
              : " Document upload did not complete—please upload files in the client dashboard.";
            formMessage.textContent = `Secure intake submitted.${detail}`;
          } else if (filesToUpload.length) {
            const dlpNote = uploadResult.dlpHits
              ? " Sensitive data was detected and flagged for preparer review."
              : "";
            formMessage.textContent =
              `Secure intake submitted. Documents uploaded to your secure vault.${dlpNote}`;
          } else {
            formMessage.textContent =
              "Secure intake submitted. Your assigned preparer will contact you with next steps.";
          }
        }
        if (intakeReceipt) {
          const receiptId = `ASTA-${Date.now().toString(36).toUpperCase()}`;
          const baseLine = filesToUpload.length ? "Upload complete" : "Submission logged";
          intakeReceipt.textContent = `${baseLine} • Receipt ${receiptId} • ${new Date().toLocaleString()}`;
          intakeReceipt.classList.add("is-visible");
        }
        if (postSubmit) {
          postSubmit.classList.add("is-visible");
        }
        form.reset();
        rawSsn = "";
        syncMaskedValue();
        updateProgress();
        updateIntakeEstimate();
        setEditingState(false);
        await checkExistingIntake();
      } catch (error) {
        if (!formMessage?.classList.contains("is-error")) {
          showErrors([{ message: error.message || "Submission failed. Please try again." }]);
        }
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.classList.remove("is-busy");
          submitButton.textContent = originalText;
        }
      }
  });
  }
}

if (estimateForm) {
  estimateForm.addEventListener("input", updateEstimate);
  estimateForm.addEventListener("change", updateEstimate);
  updateEstimate();
}

const setIntakeLocked = (status) => {
  if (!form || !intakeLocked) return;
  if (status?.locked) {
    setEditingState(false);
    form.classList.add("is-hidden");
    intakeLocked.hidden = false;
    if (intakeNav) {
      intakeNav.classList.add("is-hidden");
      intakeNav.setAttribute("aria-disabled", "true");
    }
    if (intakeCta) {
      intakeCta.setAttribute("disabled", "true");
      intakeCta.classList.add("is-disabled");
      intakeCta.textContent = "Intake on file";
    }
    if (intakeLockDate) {
      intakeLockDate.textContent = status.createdAt || "recently";
    }
    if (intakeLockYear) {
      intakeLockYear.textContent = status.filingYear || "current";
    }
    if (intakeReceipt) {
      intakeReceipt.textContent = "";
      intakeReceipt.classList.remove("is-visible");
    }
    return;
  }

  form.classList.remove("is-hidden");
  intakeLocked.hidden = true;
  if (intakeNav) {
    intakeNav.classList.remove("is-hidden");
    intakeNav.removeAttribute("aria-disabled");
  }
  if (intakeCta) {
    intakeCta.removeAttribute("disabled");
    intakeCta.classList.remove("is-disabled");
    intakeCta.textContent = "Launch Secure Intake";
  }
};

const checkExistingIntake = async () => {
  if (!supabase) return;
  const context = await getUserContext();
  if (!context?.user) return;
  const params = new URLSearchParams();
  if (context.user.id) params.set("client_user_id", context.user.id);
  if (context.user.email) params.set("email", context.user.email);
  try {
    const response = await fetch(`/api/intake/status?${params.toString()}`);
    if (!response.ok) {
      setIntakeLocked({ locked: false });
      return;
    }
    const data = await response.json();
    if (data?.found) {
      const createdAt = data.created_at ? new Date(data.created_at).toLocaleDateString() : "recently";
      const filingYear = data.filing_year ? String(data.filing_year) : "current";
      setIntakeLocked({ locked: true, createdAt, filingYear });
    } else {
      setIntakeLocked({ locked: false });
    }
  } catch (error) {
    setIntakeLocked({ locked: false });
  }
};

checkExistingIntake();
