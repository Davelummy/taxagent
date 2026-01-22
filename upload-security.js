const MAX_SCAN_BYTES = 200000;
const EICAR_SIGNATURE = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE";
const SSN_PATTERN = /(^|\D)\d{3}-?\d{2}-?\d{4}(?!\d)/;

const SIGNATURES = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/jpeg": [0xff, 0xd8, 0xff],
};

const getExpectedSignature = (file) => {
  if (SIGNATURES[file.type]) {
    return { type: file.type, signature: SIGNATURES[file.type] };
  }
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return { type: "application/pdf", signature: SIGNATURES["application/pdf"] };
  if (extension === "png") return { type: "image/png", signature: SIGNATURES["image/png"] };
  if (extension === "jpg" || extension === "jpeg") {
    return { type: "image/jpeg", signature: SIGNATURES["image/jpeg"] };
  }
  return null;
};

const matchesSignature = (bytes, signature) => {
  if (!signature || bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
};

const readSample = async (file) => {
  const slice = file.slice(0, MAX_SCAN_BYTES);
  const buffer = await slice.arrayBuffer();
  return new Uint8Array(buffer);
};

const decodeSample = (bytes) => {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch (error) {
    return "";
  }
};

const scanFile = async (file) => {
  const expected = getExpectedSignature(file);
  const sample = await readSample(file);
  if (expected && !matchesSignature(sample, expected.signature)) {
    return {
      ok: false,
      malware: true,
      dlp: false,
      message: `File signature mismatch detected in ${file.name}.`,
    };
  }

  const text = decodeSample(sample);
  if (text.includes(EICAR_SIGNATURE)) {
    return {
      ok: false,
      malware: true,
      dlp: false,
      message: `Malware test signature detected in ${file.name}.`,
    };
  }

  const dlpHit = SSN_PATTERN.test(text);
  return {
    ok: true,
    malware: false,
    dlp: dlpHit,
    message: dlpHit ? `Sensitive data detected in ${file.name}.` : "",
  };
};

export const scanFiles = async (files, onProgress) => {
  if (!files || !files.length) {
    return { ok: true, dlpHits: 0, warnings: [], results: [] };
  }
  let dlpHits = 0;
  const warnings = [];
  const results = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (onProgress) {
      onProgress(`Screening ${file.name} (${index + 1} of ${files.length})...`);
    }
    const result = await scanFile(file);
    results.push({ name: file.name, ok: result.ok, dlp: result.dlp, message: result.message });
    if (!result.ok) {
      return { ok: false, message: result.message || "Upload blocked by security screening.", results };
    }
    if (result.dlp) {
      dlpHits += 1;
      warnings.push(result.message);
    }
  }

  if (onProgress) {
    onProgress("");
  }

  return { ok: true, dlpHits, warnings, results };
};
