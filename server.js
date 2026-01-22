import express from "express";
import { Pool } from "pg";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();
const port = process.env.PORT || 5173;
const hostArgIndex = process.argv.indexOf("--host");
const host = (hostArgIndex !== -1 && process.argv[hostArgIndex + 1]) || process.env.HOST || "127.0.0.1";

const baseDir = process.cwd();

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error("DATABASE_URL is not set.");
}

const encryptionKey = process.env.SSN_ENCRYPTION_KEY;
if (!encryptionKey) {
  throw new Error("SSN_ENCRYPTION_KEY is not set.");
}

const keyBytes = Buffer.from(encryptionKey, "base64");
if (keyBytes.length !== 32) {
  throw new Error("SSN_ENCRYPTION_KEY must be 32 bytes (base64 encoded).");
}

const pool = new Pool({ connectionString: dbUrl });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseBucket = process.env.SUPABASE_BUCKET || "client-uploads";
const supabaseHiddenTable = process.env.SUPABASE_HIDDEN_TABLE || "upload_visibility";
const preparerEmailDomain = process.env.PREPARER_EMAIL_DOMAIN || "";
const preparerEmailList = process.env.PREPARER_EMAILS || "";
const hasStorageAccess = Boolean(supabaseUrl && supabaseServiceKey);
const hasPreparerAuth = Boolean(supabaseUrl && (supabaseServiceKey || supabaseAnonKey));

app.disable("x-powered-by");

const buildCsp = () => {
  const sources = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "script-src": ["'self'", "https://cdn.jsdelivr.net"],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
    "img-src": ["'self'", "data:", "https://images.unsplash.com", "https://*.supabase.co"],
    "connect-src": ["'self'", "https://*.supabase.co"],
    "frame-src": ["'self'", "https://*.supabase.co"],
  };

  return Object.entries(sources)
    .map(([key, value]) => `${key} ${value.join(" ")}`)
    .join("; ");
};

app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", buildCsp());
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(express.static(baseDir));

const rateLimit = ({ windowMs, max, message }) => {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.connection?.remoteAddress || "unknown";
    const entry = hits.get(key) || { count: 0, start: now };
    if (now - entry.start > windowMs) {
      entry.count = 0;
      entry.start = now;
    }
    entry.count += 1;
    hits.set(key, entry);
    if (entry.count > max) {
      return res.status(429).json({ error: message });
    }
    return next();
  };
};

app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    message: "Too many requests. Please try again later.",
  })
);

app.use(
  "/api/intake",
  rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 8,
    message: "Too many intake submissions. Please wait a few minutes and try again.",
  })
);

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON payload." });
  }
  return next(err);
});

const toNullableNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toNullableInt = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) ? num : null;
};

const cleanText = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
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
};

const computeEstimate = (data) => {
  const year = String(data.filing_year || "");
  const status = String(data.filing_status || "");
  const config = taxConfig[year];
  if (!config || !config.brackets?.[status]) {
    return null;
  }
  const wages = toAmount(data.wages);
  const income1099 = toAmount(data.income_1099);
  const investment = toAmount(data.investment_income);
  const retirement = toAmount(data.retirement);
  const totalIncome = wages + income1099 + investment + retirement;
  const mortgage = toAmount(data.mortgage);
  const charity = toAmount(data.charity);
  const studentLoan = toAmount(data.student_loan);
  const hsa = toAmount(data.hsa);
  const itemized = mortgage + charity + studentLoan;
  const standardDeduction = config.standardDeduction[status] || 0;
  const deduction = Math.max(standardDeduction, itemized);
  const taxableIncome = Math.max(0, totalIncome - hsa - deduction);
  const estimatedTax = computeTax(taxableIncome, config.brackets[status]);
  const withheld = toAmount(data.federal_withholding);
  const refund = withheld - estimatedTax;
  return {
    estimated_income: totalIncome,
    estimated_taxable: taxableIncome,
    estimated_tax: estimatedTax,
    estimated_withholding: withheld,
    estimated_refund: refund,
  };
};

const normalizeSsn = (value) => {
  if (typeof value !== "string") return "";
  return value.replace(/\D/g, "").slice(0, 9);
};

const normalizeIpPin = (value) => {
  if (typeof value !== "string") return "";
  return value.replace(/\D/g, "").slice(0, 6);
};

const normalizeUsername = (value) => {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "_");
};

const encryptSensitive = (value) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBytes, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
};

const normalizeEmail = (value) => (value ? value.trim().toLowerCase() : "");

const isPreparerAllowed = (email) => {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const domain = preparerEmailDomain.trim().toLowerCase().replace(/^@/, "");
  if (domain) {
    return normalized.endsWith(`@${domain}`);
  }
  const allowed = preparerEmailList
    .split(/[,\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.length) return false;
  return allowed.includes(normalized);
};

const fetchSupabaseUser = async (token) => {
  if (!hasPreparerAuth) {
    throw new Error("Preparer auth not configured.");
  }
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseServiceKey || supabaseAnonKey,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || "Invalid auth token.");
  }
  return data;
};

const requirePreparerAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing authorization." });
    }
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      return res.status(401).json({ error: "Missing authorization." });
    }
    const user = await fetchSupabaseUser(token);
    if (!user?.email) {
      return res.status(401).json({ error: "Invalid user session." });
    }
    if (!isPreparerAllowed(user.email)) {
      return res.status(403).json({ error: "Access restricted." });
    }
    req.preparerUser = user;
    return next();
  } catch (error) {
    return res.status(401).json({ error: error.message || "Unauthorized." });
  }
};

const requireSupabaseAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing authorization." });
    }
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      return res.status(401).json({ error: "Missing authorization." });
    }
    const user = await fetchSupabaseUser(token);
    if (!user?.email) {
      return res.status(401).json({ error: "Invalid user session." });
    }
    req.supabaseUser = user;
    return next();
  } catch (error) {
    return res.status(401).json({ error: error.message || "Unauthorized." });
  }
};

const detectDocumentType = (name, category) => {
  if (!name) return { label: "Document", requirement: "other" };
  if (category === "authorization") {
    return { label: "Form 8879", requirement: "auth" };
  }
  const normalized = String(name).toLowerCase().replace(/[^a-z0-9]/g, "");
  const matches = (token) => normalized.includes(String(token).toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (matches("w2") || matches("w-2") || matches("w_2")) {
    return { label: "W-2", requirement: "income" };
  }
  if (matches("1099")) {
    return { label: "1099", requirement: "income" };
  }
  if (matches("1098")) {
    return { label: "1098", requirement: "mortgage" };
  }
  if (matches("photoid") || matches("passport") || matches("driverlicense") || matches("license") || matches("idcard") || matches("id")) {
    return { label: "Photo ID", requirement: "identity" };
  }
  if (matches("k1") || matches("k-1") || matches("schedulek1")) {
    return { label: "Schedule K-1", requirement: "income" };
  }
  return { label: "Document", requirement: "other" };
};

const logAuditEvent = async (event) => {
  const payload = {
    actor_user_id: event.actor_user_id || null,
    actor_email: event.actor_email || null,
    actor_role: event.actor_role || null,
    action_type: event.action_type || null,
    target_user_id: event.target_user_id || null,
    target_email: event.target_email || null,
    target_username: event.target_username || null,
    metadata: event.metadata || null,
  };
  try {
    await pool.query(
      `
        INSERT INTO audit_events (
          actor_user_id,
          actor_email,
          actor_role,
          action_type,
          target_user_id,
          target_email,
          target_username,
          metadata,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW());
      `,
      [
        payload.actor_user_id,
        payload.actor_email,
        payload.actor_role,
        payload.action_type,
        payload.target_user_id,
        payload.target_email,
        payload.target_username,
        payload.metadata ? JSON.stringify(payload.metadata) : null,
      ]
    );
  } catch (error) {
    console.warn("Audit log failed", error);
  }
};

const listStorageObjects = async (prefix, limit = 200) => {
  if (!hasStorageAccess) return { ok: false, data: [] };
  const response = await fetch(`${supabaseUrl}/storage/v1/object/list/${supabaseBucket}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseServiceKey}`,
    },
    body: JSON.stringify({ prefix, limit, sortBy: { column: "created_at", order: "desc" } }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Supabase storage list failed.");
  }
  return { ok: true, data: Array.isArray(data) ? data : [] };
};

const fetchHiddenPathsForUser = async (userId) => {
  if (!hasStorageAccess || !supabaseHiddenTable || !userId) return new Set();
  const url = new URL(`${supabaseUrl}/rest/v1/${supabaseHiddenTable}`);
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("select", "path,hidden");
  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${supabaseServiceKey}`,
      apikey: supabaseServiceKey,
    },
  });
  if (!response.ok) {
    return new Set();
  }
  const data = await response.json();
  return new Set(
    (Array.isArray(data) ? data : [])
      .filter((row) => row?.path && row.hidden === true)
      .map((row) => row.path)
  );
};

const buildStorageStats = async (usernames) => {
  if (!hasStorageAccess || !usernames.length) {
    return { available: false, stats: {} };
  }

  const stats = {};
  await Promise.all(
    usernames.map(async (username) => {
      const usernameKey = normalizeUsername(username);
      if (!usernameKey) return;
      const [docs, auth] = await Promise.all([
        listStorageObjects(`uploads/${usernameKey}`),
        listStorageObjects(`authorizations/${usernameKey}`),
      ]);
      const docItems = docs.ok ? docs.data : [];
      const authItems = auth.ok ? auth.data : [];
      const allItems = [...docItems, ...authItems];
      let latest = null;
      allItems.forEach((item) => {
        if (!item.created_at) return;
        const value = new Date(item.created_at);
        if (!latest || value > latest) {
          latest = value;
        }
      });
      stats[usernameKey] = {
        documents: docItems.length,
        authorizations: authItems.length,
        last_upload_at: latest ? latest.toISOString() : null,
      };
    })
  );

  return { available: true, stats };
};

app.post("/api/intake", async (req, res) => {
  try {
    const data = req.body || {};
    const ssn = normalizeSsn(data.ssn);
    const ipPin = normalizeIpPin(data.ip_pin);

    const firstName = cleanText(data.first_name);
    const lastName = cleanText(data.last_name);
    const dob = cleanText(data.dob);
    const email = cleanText(data.email);
    const phone = cleanText(data.phone);
    const filingStatus = cleanText(data.filing_status);
    const filingYear = toNullableInt(data.filing_year);
    const consent = data.consent === true || data.consent === "true" || data.consent === "on";
    const dependents = toNullableInt(data.dependents);
    const clientUserId =
      cleanText(data.client_user_id) || (uploaderRole === "client" ? supabaseUser?.id : null);
    const clientUsername = cleanText(data.client_username);

    if (!firstName || !lastName || !dob || !email || !phone || !filingStatus || !consent) {
      return res.status(400).json({ error: "Missing or invalid required fields." });
    }

    if (ssn.length && ssn.length !== 9) {
      return res.status(400).json({ error: "Invalid SSN." });
    }

    if (ipPin.length && ipPin.length !== 6) {
      return res.status(400).json({ error: "Invalid IP PIN." });
    }

    if (!filingYear || filingYear < 2000 || filingYear > 2100) {
      return res.status(400).json({ error: "Invalid filing year." });
    }

    if (dependents !== null && (dependents < 0 || dependents > 20)) {
      return res.status(400).json({ error: "Dependents must be between 0 and 20." });
    }

    const estimate = computeEstimate({
      filing_year: filingYear,
      filing_status: filingStatus,
      wages: data.wages,
      income_1099: data.income_1099,
      investment_income: data.investment_income,
      retirement: data.retirement,
      mortgage: data.mortgage,
      charity: data.charity,
      student_loan: data.student_loan,
      hsa: data.hsa,
      federal_withholding: data.federal_withholding,
    });

    const ssnEncrypted = ssn.length === 9 ? encryptSensitive(ssn) : null;
    const ipPinEncrypted = ipPin.length === 6 ? encryptSensitive(ipPin) : null;

    const values = [
      firstName,
      lastName,
      ssnEncrypted,
      ipPinEncrypted,
      filingYear,
      dob,
      email,
      phone,
      cleanText(data.employer),
      toNullableNumber(data.wages),
      toNullableNumber(data.federal_withholding),
      toNullableNumber(data.income_1099),
      toNullableNumber(data.investment_income),
      toNullableNumber(data.retirement),
      cleanText(data.other_income),
      toNullableNumber(data.mortgage),
      toNullableNumber(data.charity),
      toNullableNumber(data.student_loan),
      dependents,
      toNullableNumber(data.hsa),
      cleanText(data.other_deductions),
      filingStatus,
      cleanText(data.filing_method),
      cleanText(data.contact_method),
      cleanText(data.notes),
      consent,
      clientUserId,
      clientUsername,
      estimate?.estimated_income ?? null,
      estimate?.estimated_taxable ?? null,
      estimate?.estimated_tax ?? null,
      estimate?.estimated_withholding ?? null,
      estimate?.estimated_refund ?? null,
      "received",
      null,
      new Date(),
    ];

    const query = `
      INSERT INTO intake_submissions (
        first_name,
        last_name,
        ssn_encrypted,
        ip_pin_encrypted,
        filing_year,
        dob,
        email,
        phone,
        employer,
        wages,
        federal_withholding,
        income_1099,
        investment_income,
        retirement,
        other_income,
        mortgage,
        charity,
        student_loan,
        dependents,
        hsa,
        other_deductions,
        filing_status,
        filing_method,
        contact_method,
        notes,
        consent,
        client_user_id,
        client_username,
        estimated_income,
        estimated_taxable,
        estimated_tax,
        estimated_withholding,
        estimated_refund,
        review_status,
        review_notes,
        review_updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36
      )
      RETURNING id;
    `;

    const result = await pool.query(query, values);
    await logAuditEvent({
      actor_user_id: clientUserId,
      actor_email: email,
      actor_role: "client",
      action_type: "intake_submitted",
      target_user_id: clientUserId,
      target_email: email,
      target_username: clientUsername,
      metadata: {
        filing_year: filingYear,
        filing_status: filingStatus,
      },
    });
    return res.json({ ok: true, id: result.rows[0]?.id });
  } catch (error) {
    console.error("Intake submission failed", error);
    return res.status(500).json({ error: "Server error." });
  }
});

app.get("/api/intake/latest", requireSupabaseAuth, async (req, res) => {
  try {
    const user = req.supabaseUser;
    const clientUserId = cleanText(user?.id);
    const email = normalizeEmail(user?.email || "");
    const result = await pool.query(
      `
        SELECT id,
               first_name,
               last_name,
               filing_year,
               filing_status,
               dob,
               email,
               phone,
               employer,
               wages,
               federal_withholding,
               income_1099,
               investment_income,
               retirement,
               other_income,
               mortgage,
               charity,
               student_loan,
               dependents,
               hsa,
               other_deductions,
               filing_method,
               contact_method,
               notes,
               consent,
               client_username
        FROM intake_submissions
        WHERE client_user_id = $1 OR email = $2
        ORDER BY created_at DESC
        LIMIT 1;
      `,
      [clientUserId, email]
    );
    if (!result.rows.length) {
      return res.json({ found: false });
    }
    return res.json({ found: true, intake: result.rows[0] });
  } catch (error) {
    console.error("Intake lookup failed", error);
    return res.status(500).json({ error: "Server error." });
  }
});

app.patch("/api/intake", requireSupabaseAuth, async (req, res) => {
  try {
    const data = req.body || {};
    const intakeId = toNullableInt(data.intake_id);
    if (!intakeId) {
      return res.status(400).json({ error: "Missing intake identifier." });
    }
    const supabaseUser = req.supabaseUser;
    const clientUserId = cleanText(supabaseUser?.id);
    const email = normalizeEmail(supabaseUser?.email || "");
    const existing = await pool.query(
      "SELECT client_user_id, email FROM intake_submissions WHERE id = $1 LIMIT 1;",
      [intakeId]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ error: "Intake record not found." });
    }
    const existingRow = existing.rows[0];
    const existingEmail = normalizeEmail(existingRow.email || "");
    if (existingRow.client_user_id && existingRow.client_user_id !== clientUserId) {
      return res.status(403).json({ error: "Unauthorized update." });
    }
    if (!existingRow.client_user_id && existingEmail && existingEmail !== email) {
      return res.status(403).json({ error: "Unauthorized update." });
    }

    const ssn = normalizeSsn(data.ssn);
    const ipPin = normalizeIpPin(data.ip_pin);
    const firstName = cleanText(data.first_name);
    const lastName = cleanText(data.last_name);
    const dob = cleanText(data.dob);
    const phone = cleanText(data.phone);
    const filingStatus = cleanText(data.filing_status);
    const filingYear = toNullableInt(data.filing_year);
    const consent = data.consent === true || data.consent === "true" || data.consent === "on";
    const dependents = toNullableInt(data.dependents);
    const clientUsername = cleanText(data.client_username);

    if (!firstName || !lastName || !dob || !email || !phone || !filingStatus || !consent) {
      return res.status(400).json({ error: "Missing or invalid required fields." });
    }

    if (ssn.length !== 9) {
      return res.status(400).json({ error: "Invalid SSN." });
    }

    if (ipPin.length !== 6) {
      return res.status(400).json({ error: "Invalid IP PIN." });
    }

    if (!filingYear || filingYear < 2000 || filingYear > 2100) {
      return res.status(400).json({ error: "Invalid filing year." });
    }

    if (dependents !== null && (dependents < 0 || dependents > 20)) {
      return res.status(400).json({ error: "Dependents must be between 0 and 20." });
    }

    const estimate = computeEstimate({
      filing_year: filingYear,
      filing_status: filingStatus,
      wages: data.wages,
      income_1099: data.income_1099,
      investment_income: data.investment_income,
      retirement: data.retirement,
      mortgage: data.mortgage,
      charity: data.charity,
      student_loan: data.student_loan,
      hsa: data.hsa,
      federal_withholding: data.federal_withholding,
    });

    const ssnEncrypted = encryptSensitive(ssn);
    const ipPinEncrypted = encryptSensitive(ipPin);

    const values = [
      firstName,
      lastName,
      ssnEncrypted,
      ipPinEncrypted,
      filingYear,
      dob,
      email,
      phone,
      cleanText(data.employer),
      toNullableNumber(data.wages),
      toNullableNumber(data.federal_withholding),
      toNullableNumber(data.income_1099),
      toNullableNumber(data.investment_income),
      toNullableNumber(data.retirement),
      cleanText(data.other_income),
      toNullableNumber(data.mortgage),
      toNullableNumber(data.charity),
      toNullableNumber(data.student_loan),
      dependents,
      toNullableNumber(data.hsa),
      cleanText(data.other_deductions),
      filingStatus,
      cleanText(data.filing_method),
      cleanText(data.contact_method),
      cleanText(data.notes),
      consent,
      clientUserId,
      clientUsername,
      estimate?.estimated_income ?? null,
      estimate?.estimated_taxable ?? null,
      estimate?.estimated_tax ?? null,
      estimate?.estimated_withholding ?? null,
      estimate?.estimated_refund ?? null,
      intakeId,
      clientUserId,
      email,
    ];

    const query = `
      UPDATE intake_submissions
      SET first_name = $1,
          last_name = $2,
          ssn_encrypted = COALESCE($3, ssn_encrypted),
          ip_pin_encrypted = COALESCE($4, ip_pin_encrypted),
          filing_year = $5,
          dob = $6,
          email = $7,
          phone = $8,
          employer = $9,
          wages = $10,
          federal_withholding = $11,
          income_1099 = $12,
          investment_income = $13,
          retirement = $14,
          other_income = $15,
          mortgage = $16,
          charity = $17,
          student_loan = $18,
          dependents = $19,
          hsa = $20,
          other_deductions = $21,
          filing_status = $22,
          filing_method = $23,
          contact_method = $24,
          notes = $25,
          consent = $26,
          client_user_id = $27,
          client_username = $28,
          estimated_income = $29,
          estimated_taxable = $30,
          estimated_tax = $31,
          estimated_withholding = $32,
          estimated_refund = $33,
          review_status = 'received',
          review_notes = NULL,
          review_updated_at = NOW()
      WHERE id = $34
        AND (client_user_id = $35 OR (client_user_id IS NULL AND email = $36))
      RETURNING id;
    `;

    const result = await pool.query(query, values);
    if (!result.rows.length) {
      return res.status(404).json({ error: "Intake record not found." });
    }
    await logAuditEvent({
      actor_user_id: clientUserId,
      actor_email: email,
      actor_role: "client",
      action_type: "intake_updated",
      target_user_id: clientUserId,
      target_email: email,
      target_username: clientUsername,
      metadata: {
        filing_year: filingYear,
        filing_status: filingStatus,
      },
    });
    return res.json({ ok: true, id: result.rows[0]?.id });
  } catch (error) {
    console.error("Intake update failed", error);
    return res.status(500).json({ error: "Server error." });
  }
});

app.post("/api/profile", async (req, res) => {
  try {
    const data = req.body || {};
    const supabaseUserId = cleanText(data.supabase_user_id);
    const email = cleanText(data.email);
    const username = cleanText(data.username);
    const fullName = cleanText(data.full_name);
    const phone = cleanText(data.phone);

    if (!supabaseUserId || !email) {
      return res.status(400).json({ error: "Missing required profile fields." });
    }

    const query = `
      INSERT INTO client_profiles (
        supabase_user_id,
        email,
        username,
        full_name,
        phone,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (supabase_user_id)
      DO UPDATE SET
        email = EXCLUDED.email,
        username = COALESCE(EXCLUDED.username, client_profiles.username),
        full_name = COALESCE(EXCLUDED.full_name, client_profiles.full_name),
        phone = COALESCE(EXCLUDED.phone, client_profiles.phone),
        updated_at = NOW()
      RETURNING supabase_user_id;
    `;

    const result = await pool.query(query, [supabaseUserId, email, username, fullName, phone]);
    return res.json({ ok: true, id: result.rows[0]?.supabase_user_id });
  } catch (error) {
    console.error("Profile sync failed", error);
    return res.status(500).json({ error: "Server error." });
  }
});

app.post("/api/contact", async (req, res) => {
  try {
    const data = req.body || {};
    const name = cleanText(data.name);
    const email = cleanText(data.email);
    const company = cleanText(data.company);
    const role = cleanText(data.role);
    const preferredTime = cleanText(data.preferred_time);
    const message = cleanText(data.message);
    if (!name || !email || !message) {
      return res.status(400).json({ error: "Missing required fields." });
    }
    await pool.query(
      `
        INSERT INTO contact_requests (
          name,
          email,
          company,
          role,
          preferred_time,
          message,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW());
      `,
      [name, email, company, role, preferredTime, message]
    );
    return res.json({ ok: true });
  } catch (error) {
    console.error("Contact request failed", error);
    return res.status(500).json({ error: "Server error." });
  }
});

app.post("/api/preparer/profile", requirePreparerAuth, async (req, res) => {
  try {
    const data = req.body || {};
    const supabaseUserId = cleanText(data.supabase_user_id);
    const email = cleanText(data.email);
    const fullName = cleanText(data.full_name);
    const phone = cleanText(data.phone);

    if (!supabaseUserId || !email) {
      return res.status(400).json({ error: "Missing required preparer fields." });
    }

    const query = `
      INSERT INTO preparer_profiles (
        supabase_user_id,
        email,
        full_name,
        phone,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (supabase_user_id)
      DO UPDATE SET
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, preparer_profiles.full_name),
        phone = COALESCE(EXCLUDED.phone, preparer_profiles.phone),
        updated_at = NOW()
      RETURNING supabase_user_id;
    `;

    const result = await pool.query(query, [supabaseUserId, email, fullName, phone]);
    return res.json({ ok: true, id: result.rows[0]?.supabase_user_id });
  } catch (error) {
    console.error("Preparer profile sync failed", error);
    return res.status(500).json({ error: "Server error." });
  }
});

app.get("/api/intake/status", async (req, res) => {
  try {
    const clientUserId = cleanText(req.query.client_user_id);
    const email = cleanText(req.query.email);
    if (!clientUserId && !email) {
      return res.status(400).json({ error: "Missing client identifier." });
    }

    const params = [clientUserId || email];
    const baseSelect = "review_status, review_notes, review_updated_at, filing_year, created_at";
    const estimateSelect = "estimated_refund, estimated_tax, estimated_withholding, estimated_taxable";
    const queryWithEstimate = clientUserId
      ? `
        SELECT ${baseSelect}, ${estimateSelect}
        FROM intake_submissions
        WHERE client_user_id = $1
        ORDER BY created_at DESC
        LIMIT 1;
      `
      : `
        SELECT ${baseSelect}, ${estimateSelect}
        FROM intake_submissions
        WHERE email = $1
        ORDER BY created_at DESC
        LIMIT 1;
      `;
    const queryFallback = clientUserId
      ? `
        SELECT ${baseSelect}
        FROM intake_submissions
        WHERE client_user_id = $1
        ORDER BY created_at DESC
        LIMIT 1;
      `
      : `
        SELECT ${baseSelect}
        FROM intake_submissions
        WHERE email = $1
        ORDER BY created_at DESC
        LIMIT 1;
      `;

    let result;
    try {
      result = await pool.query(queryWithEstimate, params);
    } catch (error) {
      if (error.code === "42703") {
        result = await pool.query(queryFallback, params);
      } else {
        throw error;
      }
    }
    if (!result.rows.length) {
      return res.json({ found: false });
    }

    const row = result.rows[0];
    const detailMap = {
      received: "Intake received. Your preparer will begin review shortly.",
      in_review: "Your preparer is validating documents and confirming filing details.",
      awaiting_documents: "Additional documents requested. Upload via the client dashboard.",
      awaiting_authorization: "Form 8879 is required before e-file can proceed.",
      ready_to_file: "All items verified. Your return is queued for e-file.",
      filed: "Return transmitted to the IRS. Confirmation pending.",
    };

    return res.json({
      found: true,
      review_status: row.review_status || "received",
      review_notes: row.review_notes || "",
      review_updated_at: row.review_updated_at,
      review_detail: detailMap[row.review_status] || detailMap.received,
      filing_year: row.filing_year,
      estimated_refund: row.estimated_refund ?? null,
      estimated_tax: row.estimated_tax ?? null,
      estimated_withholding: row.estimated_withholding ?? null,
      estimated_taxable: row.estimated_taxable ?? null,
      created_at: row.created_at,
    });
  } catch (error) {
    console.error("Intake status lookup failed", error);
    return res.status(500).json({ error: "Server error." });
  }
});

app.get("/api/preparer/overview", requirePreparerAuth, async (req, res) => {
  try {
    const adminDomain = preparerEmailDomain.trim().toLowerCase().replace(/^@/, "");
    const telemetryEnabled = req.query.telemetry !== "0";
    const filterValue = adminDomain ? `%@${adminDomain}` : null;

    const clientCountQuery = adminDomain
      ? {
          text: "SELECT COUNT(*)::int AS count FROM client_profiles WHERE lower(email) NOT LIKE $1;",
          values: [filterValue],
        }
      : { text: "SELECT COUNT(*)::int AS count FROM client_profiles;", values: [] };

    const intakeCountQuery = adminDomain
      ? {
          text: "SELECT COUNT(*)::int AS count FROM intake_submissions WHERE lower(email) NOT LIKE $1;",
          values: [filterValue],
        }
      : { text: "SELECT COUNT(*)::int AS count FROM intake_submissions;", values: [] };

    const statusCountQuery = adminDomain
      ? {
          text:
            "SELECT review_status, COUNT(*)::int AS count FROM intake_submissions WHERE lower(email) NOT LIKE $1 GROUP BY review_status;",
          values: [filterValue],
        }
      : {
          text: "SELECT review_status, COUNT(*)::int AS count FROM intake_submissions GROUP BY review_status;",
          values: [],
        };

    const intakeQuery = adminDomain
      ? {
          text: `
          SELECT
            i.id,
            i.client_user_id,
            COALESCE(i.client_username, p.username) AS client_username,
            i.email,
            i.first_name,
            i.last_name,
            i.filing_year,
            i.review_status,
            i.review_notes,
            i.review_updated_at,
            i.created_at,
            p.full_name AS profile_name,
            p.phone AS profile_phone
          FROM intake_submissions i
          LEFT JOIN client_profiles p ON p.supabase_user_id = i.client_user_id
          WHERE lower(i.email) NOT LIKE $1
          ORDER BY i.created_at DESC
          LIMIT 40;
        `,
          values: [filterValue],
        }
      : {
          text: `
          SELECT
            i.id,
            i.client_user_id,
            COALESCE(i.client_username, p.username) AS client_username,
            i.email,
            i.first_name,
            i.last_name,
            i.filing_year,
            i.review_status,
            i.review_notes,
            i.review_updated_at,
            i.created_at,
            p.full_name AS profile_name,
            p.phone AS profile_phone
          FROM intake_submissions i
          LEFT JOIN client_profiles p ON p.supabase_user_id = i.client_user_id
          ORDER BY i.created_at DESC
          LIMIT 40;
        `,
          values: [],
        };

    const clientQuery = adminDomain
      ? {
          text: `
          SELECT
            p.supabase_user_id,
            p.email,
            p.username,
            p.full_name,
            p.phone,
            p.created_at,
            p.updated_at,
            i.review_status AS intake_status,
            i.filing_year AS intake_filing_year,
            i.created_at AS intake_created_at
          FROM client_profiles p
          LEFT JOIN LATERAL (
            SELECT review_status, filing_year, created_at
            FROM intake_submissions
            WHERE client_user_id = p.supabase_user_id OR email = p.email
            ORDER BY created_at DESC
            LIMIT 1
          ) i ON true
          WHERE lower(p.email) NOT LIKE $1
          ORDER BY p.created_at DESC
          LIMIT 60;
        `,
          values: [filterValue],
        }
      : {
          text: `
          SELECT
            p.supabase_user_id,
            p.email,
            p.username,
            p.full_name,
            p.phone,
            p.created_at,
            p.updated_at,
            i.review_status AS intake_status,
            i.filing_year AS intake_filing_year,
            i.created_at AS intake_created_at
          FROM client_profiles p
          LEFT JOIN LATERAL (
            SELECT review_status, filing_year, created_at
            FROM intake_submissions
            WHERE client_user_id = p.supabase_user_id OR email = p.email
            ORDER BY created_at DESC
            LIMIT 1
          ) i ON true
          ORDER BY p.created_at DESC
          LIMIT 60;
        `,
          values: [],
        };

    let clientCountResult;
    let intakeCountResult;
    let statusCountResult;
    let intakeResult;
    let clientResult;
    try {
      [clientCountResult, intakeCountResult, statusCountResult, intakeResult, clientResult] =
        await Promise.all([
          pool.query(clientCountQuery),
          pool.query(intakeCountQuery),
          pool.query(statusCountQuery),
          pool.query(intakeQuery),
          pool.query(clientQuery),
        ]);
    } catch (error) {
      if (error.code === "42P01") {
        return res.status(500).json({ error: "Database schema missing. Run schema.sql in Neon." });
      }
      if (error.code !== "42703") {
        throw error;
      }
      const fallbackIntakeQuery = adminDomain
        ? {
            text: `
            SELECT
              i.id,
              i.client_user_id,
              p.username AS client_username,
              i.email,
              i.first_name,
              i.last_name,
              i.filing_year,
              NULL AS review_status,
              NULL AS review_notes,
              NULL AS review_updated_at,
              i.created_at,
              p.full_name AS profile_name,
              p.phone AS profile_phone
            FROM intake_submissions i
            LEFT JOIN client_profiles p ON p.supabase_user_id = i.client_user_id
            WHERE lower(i.email) NOT LIKE $1
            ORDER BY i.created_at DESC
            LIMIT 40;
          `,
            values: [filterValue],
          }
        : {
            text: `
            SELECT
              i.id,
              i.client_user_id,
              p.username AS client_username,
              i.email,
              i.first_name,
              i.last_name,
              i.filing_year,
              NULL AS review_status,
              NULL AS review_notes,
              NULL AS review_updated_at,
              i.created_at,
              p.full_name AS profile_name,
              p.phone AS profile_phone
            FROM intake_submissions i
            LEFT JOIN client_profiles p ON p.supabase_user_id = i.client_user_id
            ORDER BY i.created_at DESC
            LIMIT 40;
          `,
            values: [],
          };
      const fallbackClientQuery = adminDomain
        ? {
            text: `
            SELECT
              p.supabase_user_id,
              p.email,
              p.username,
              p.full_name,
              p.phone,
              p.created_at,
              p.updated_at,
              NULL AS intake_status,
              NULL AS intake_filing_year,
              NULL AS intake_created_at
            FROM client_profiles p
            WHERE lower(p.email) NOT LIKE $1
            ORDER BY p.created_at DESC
            LIMIT 60;
          `,
            values: [filterValue],
          }
        : {
            text: `
            SELECT
              p.supabase_user_id,
              p.email,
              p.username,
              p.full_name,
              p.phone,
              p.created_at,
              p.updated_at,
              NULL AS intake_status,
              NULL AS intake_filing_year,
              NULL AS intake_created_at
            FROM client_profiles p
            ORDER BY p.created_at DESC
            LIMIT 60;
          `,
            values: [],
          };

      [clientCountResult, intakeCountResult, intakeResult, clientResult] = await Promise.all([
        pool.query(clientCountQuery),
        pool.query(intakeCountQuery),
        pool.query(fallbackIntakeQuery),
        pool.query(fallbackClientQuery),
      ]);
      statusCountResult = { rows: [] };
    }

    const statusCounts = {
      received: 0,
      in_review: 0,
      awaiting_documents: 0,
      awaiting_authorization: 0,
      ready_to_file: 0,
      filed: 0,
    };

    statusCountResult.rows.forEach((row) => {
      if (row.review_status in statusCounts) {
        statusCounts[row.review_status] = Number(row.count) || 0;
      }
    });

    const clientRows = clientResult.rows || [];
    const usernames = Array.from(
      new Set(clientRows.map((row) => row.username).filter(Boolean))
    );
    let uploadStats = { available: false, stats: {} };
    if (telemetryEnabled) {
      try {
        uploadStats = await buildStorageStats(usernames);
      } catch (error) {
        console.warn("Storage stats unavailable", error);
      }
    }

    return res.json({
      ok: true,
      summary: {
        total_clients: clientCountResult.rows[0]?.count || 0,
        total_intakes: intakeCountResult.rows[0]?.count || 0,
        awaiting_documents: statusCounts.awaiting_documents,
        awaiting_authorization: statusCounts.awaiting_authorization,
        ready_to_file: statusCounts.ready_to_file,
      },
      intakes: intakeResult.rows || [],
      clients: clientRows,
      upload_stats_available: uploadStats.available,
      upload_stats: uploadStats.stats,
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Preparer overview failed", error);
    return res.status(500).json({ error: "Server error." });
  }
});

app.get("/api/preparer/validate-client", requirePreparerAuth, async (req, res) => {
  try {
    const username = cleanText(req.query.username);
    if (!username) {
      return res.status(400).json({ error: "Missing username." });
    }
    const normalized = normalizeUsername(username);
    if (!normalized) {
      return res.status(400).json({ error: "Invalid username." });
    }
    const result = await pool.query(
      "SELECT 1 FROM client_profiles WHERE lower(username) = $1 LIMIT 1;",
      [normalized]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Client not found." });
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error("Client validation failed", error);
    return res.status(500).json({ error: "Server error." });
  }
});

app.get("/api/preparer/uploads", requirePreparerAuth, async (req, res) => {
  try {
    if (!hasStorageAccess) {
      return res.status(503).json({ error: "Upload telemetry not configured." });
    }
    const username = cleanText(req.query.username);
    const requestedUserId = cleanText(req.query.user_id);
    if (!username) {
      return res.status(400).json({ error: "Missing username." });
    }
    const usernameKey = normalizeUsername(username);
    if (!usernameKey) {
      return res.status(400).json({ error: "Invalid username." });
    }
    let clientUserId = requestedUserId;
    if (!clientUserId) {
      const userLookup = await pool.query(
        "SELECT supabase_user_id FROM client_profiles WHERE lower(username) = $1 LIMIT 1;",
        [usernameKey]
      );
      clientUserId = userLookup.rows[0]?.supabase_user_id || null;
    }
    const [docs, auth] = await Promise.all([
      listStorageObjects(`uploads/${usernameKey}`, 200),
      listStorageObjects(`authorizations/${usernameKey}`, 200),
    ]);
    let files = [
      ...(docs.data || []).map((item) => ({
        name: item.name,
        path: `uploads/${usernameKey}/${item.name}`,
        created_at: item.created_at,
        size: item.metadata?.size || 0,
        category: "documents",
        document_type: detectDocumentType(item.name, "documents").label,
      })),
      ...(auth.data || []).map((item) => ({
        name: item.name,
        path: `authorizations/${usernameKey}/${item.name}`,
        created_at: item.created_at,
        size: item.metadata?.size || 0,
        category: "authorization",
        document_type: detectDocumentType(item.name, "authorization").label,
      })),
    ]
      .filter((item) => item.name)
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    const recordResult = await pool.query(
      `
        SELECT storage_path, scan_status, scan_notes, dlp_hits, document_type
        FROM upload_records
        WHERE client_username = $1;
      `,
      [usernameKey]
    );
    if (recordResult.rows.length) {
      const recordMap = new Map(recordResult.rows.map((row) => [row.storage_path, row]));
      files = files.map((file) => {
        const record = recordMap.get(file.path);
        if (!record) return file;
        return {
          ...file,
          scan_status: record.scan_status,
          scan_notes: record.scan_notes,
          dlp_hits: record.dlp_hits,
          document_type: record.document_type || file.document_type,
        };
      });
    }

    const hiddenPaths = await fetchHiddenPathsForUser(clientUserId);
    files = files.map((file) => ({
      ...file,
      hidden: hiddenPaths.has(file.path),
    }));

    return res.json({ ok: true, username: usernameKey, client_user_id: clientUserId, files });
  } catch (error) {
    console.error("Preparer uploads lookup failed", error);
    return res.status(500).json({ error: "Server error." });
  }
});

app.post("/api/preparer/uploads/hide", requirePreparerAuth, async (req, res) => {
  try {
    if (!hasStorageAccess) {
      return res.status(503).json({ error: "Upload telemetry not configured." });
    }
    const data = req.body || {};
    const clientUserId = cleanText(data.client_user_id);
    const pathValue = cleanText(data.path);
    const hidden = data.hidden === true || data.hidden === "true";
    if (!clientUserId || !pathValue) {
      return res.status(400).json({ error: "Missing upload identifier." });
    }

    const url = new URL(`${supabaseUrl}/rest/v1/${supabaseHiddenTable}`);
    url.searchParams.set("user_id", `eq.${clientUserId}`);
    url.searchParams.set("path", `eq.${pathValue}`);

    if (!hidden) {
      const response = await fetch(url.toString(), {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${supabaseServiceKey}`,
          apikey: supabaseServiceKey,
        },
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        return res.status(500).json({ error: errorBody?.message || "Unable to update visibility." });
      }
      await logAuditEvent({
        actor_user_id: req.preparerUser?.id || null,
        actor_email: req.preparerUser?.email || null,
        actor_role: "preparer",
        action_type: "upload_unhidden",
        target_user_id: clientUserId,
        target_username: null,
        metadata: { path: pathValue },
      });
      return res.json({ ok: true, hidden: false });
    }

    const upsertResponse = await fetch(
      `${supabaseUrl}/rest/v1/${supabaseHiddenTable}?on_conflict=user_id,path`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
          apikey: supabaseServiceKey,
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify([
          { user_id: clientUserId, path: pathValue, hidden: true, updated_at: new Date().toISOString() },
        ]),
      }
    );
    if (!upsertResponse.ok) {
      const errorBody = await upsertResponse.json().catch(() => ({}));
      return res.status(500).json({ error: errorBody?.message || "Unable to update visibility." });
    }
    await logAuditEvent({
      actor_user_id: req.preparerUser?.id || null,
      actor_email: req.preparerUser?.email || null,
      actor_role: "preparer",
      action_type: "upload_hidden",
      target_user_id: clientUserId,
      target_username: null,
      metadata: { path: pathValue },
    });
    return res.json({ ok: true, hidden: true });
  } catch (error) {
    console.error("Upload hide failed", error);
    return res.status(500).json({ error: "Server error." });
  }
});

app.post("/api/uploads/record", requireSupabaseAuth, async (req, res) => {
  try {
    const data = req.body || {};
    const supabaseUser = req.supabaseUser;
    const uploaderEmail = supabaseUser?.email || "";
    const uploaderRole = isPreparerAllowed(uploaderEmail) ? "preparer" : "client";
    const clientUserId = cleanText(data.client_user_id);
    const clientUsername = cleanText(data.client_username);
    const fileName = cleanText(data.file_name);
    const storagePath = cleanText(data.storage_path);
    const category = cleanText(data.category) || "documents";
    const fileType = cleanText(data.file_type);
    const fileSize = toNullableNumber(data.file_size);
    const dlpHits = toNullableInt(data.dlp_hits) ?? 0;
    const scanStatus = cleanText(data.scan_status) || (dlpHits ? "flagged" : "clean");
    const scanNotes = cleanText(data.scan_notes);
    let resolvedClientUserId = clientUserId;
    if (!fileName || !storagePath) {
      return res.status(400).json({ error: "Missing upload metadata." });
    }
    if (uploaderRole === "preparer" && clientUsername) {
      const normalized = normalizeUsername(clientUsername);
      const found = await pool.query(
        "SELECT supabase_user_id FROM client_profiles WHERE lower(username) = $1 LIMIT 1;",
        [normalized]
      );
      if (!found.rows.length) {
        return res.status(404).json({ error: "Client not found." });
      }
      if (!resolvedClientUserId) {
        resolvedClientUserId = found.rows[0].supabase_user_id || null;
      }
    }
    const detected = detectDocumentType(fileName, category === "authorizations" ? "authorization" : "documents");
    await pool.query(
      `
        INSERT INTO upload_records (
          client_user_id,
          client_username,
          uploader_user_id,
          uploader_role,
          category,
          document_type,
          scan_status,
          scan_notes,
          dlp_hits,
          file_name,
          storage_path,
          file_size,
          file_type,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW());
      `,
      [
        resolvedClientUserId,
        clientUsername,
        supabaseUser?.id || null,
        uploaderRole,
        category,
        detected.label,
        scanStatus,
        scanNotes,
        dlpHits,
        fileName,
        storagePath,
        fileSize,
        fileType,
      ]
    );
    await logAuditEvent({
      actor_user_id: supabaseUser?.id || null,
      actor_email: uploaderEmail,
      actor_role: uploaderRole,
      action_type: "upload_recorded",
      target_user_id: resolvedClientUserId,
      target_email: null,
      target_username: clientUsername,
      metadata: {
        file_name: fileName,
        category,
        document_type: detected.label,
        scan_status: scanStatus,
        dlp_hits: dlpHits,
      },
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error("Upload record failed", error);
    return res.status(500).json({ error: "Server error." });
  }
});

app.get("/api/uploads/records", requireSupabaseAuth, async (req, res) => {
  try {
    const supabaseUser = req.supabaseUser;
    if (!supabaseUser?.id) {
      return res.status(401).json({ error: "Unauthorized." });
    }
    const result = await pool.query(
      `
        SELECT storage_path, scan_status, scan_notes, dlp_hits, document_type, file_name, category, created_at
        FROM upload_records
        WHERE client_user_id = $1
        ORDER BY created_at DESC;
      `,
      [supabaseUser.id]
    );
    return res.json({ ok: true, records: result.rows || [] });
  } catch (error) {
    console.error("Upload records lookup failed", error);
    return res.status(500).json({ error: "Server error." });
  }
});

const reviewStatuses = new Set([
  "received",
  "in_review",
  "awaiting_documents",
  "awaiting_authorization",
  "ready_to_file",
  "filed",
]);

app.patch("/api/intake/status", requirePreparerAuth, async (req, res) => {
  try {
    const data = req.body || {};
    const intakeId = toNullableInt(data.intake_id);
    const clientUserId = cleanText(data.client_user_id);
    const email = cleanText(data.email);
    const reviewStatus = cleanText(data.review_status);
    const reviewNotes = cleanText(data.review_notes);

    if (!reviewStatus || !reviewStatuses.has(reviewStatus)) {
      return res.status(400).json({ error: "Invalid review status." });
    }

    if (!intakeId && !clientUserId && !email) {
      return res.status(400).json({ error: "Missing intake identifier." });
    }

    let result;
    if (intakeId) {
      result = await pool.query(
        `
          UPDATE intake_submissions
          SET review_status = $1,
              review_notes = $2,
              review_updated_at = NOW()
          WHERE id = $3
          RETURNING id;
        `,
        [reviewStatus, reviewNotes, intakeId]
      );
    } else {
      const identifier = clientUserId || email;
      const clause = clientUserId ? "client_user_id" : "email";
      result = await pool.query(
        `
          WITH target AS (
            SELECT id
            FROM intake_submissions
            WHERE ${clause} = $1
            ORDER BY created_at DESC
            LIMIT 1
          )
          UPDATE intake_submissions
          SET review_status = $2,
              review_notes = $3,
              review_updated_at = NOW()
          WHERE id IN (SELECT id FROM target)
          RETURNING id;
        `,
        [identifier, reviewStatus, reviewNotes]
      );
    }

    if (!result.rows.length) {
      return res.status(404).json({ error: "Intake submission not found." });
    }

    await logAuditEvent({
      actor_user_id: req.preparerUser?.id || null,
      actor_email: req.preparerUser?.email || null,
      actor_role: "preparer",
      action_type: "intake_status_updated",
      target_user_id: clientUserId || null,
      target_email: email || null,
      target_username: null,
      metadata: {
        review_status: reviewStatus,
        review_notes: reviewNotes || "",
        intake_id: intakeId || null,
      },
    });

    return res.json({ ok: true, id: result.rows[0].id });
  } catch (error) {
    console.error("Intake status update failed", error);
    return res.status(500).json({ error: "Server error." });
  }
});

app.use((err, req, res, next) => {
  console.error("Unhandled error", err);
  res.status(500).json({ error: "Server error." });
});

const isServerless =
  Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
  String(process.env.NETLIFY || "").toLowerCase() === "true";

if (!isServerless) {
  app.listen(port, host, () => {
    console.log(`Server listening on http://${host}:${port}`);
  });
}

export { app };
