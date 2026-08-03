const UNSUPPORTED_FOLDER_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;
const WHITESPACE = /\s+/g;

export interface FolderValidationResult {
  ok: boolean;
  sanitizedName: string;
  error?: string;
}

export function validateFolderName(name: string): FolderValidationResult {
  const sanitizedName = sanitizeFolderName(name);

  if (sanitizedName.length === 0) {
    return {
      ok: false,
      sanitizedName,
      error: "Album name cannot be empty."
    };
  }

  if (sanitizedName === "." || sanitizedName === "..") {
    return {
      ok: false,
      sanitizedName,
      error: "Album name is not valid."
    };
  }

  if (sanitizedName.length > 120) {
    return {
      ok: false,
      sanitizedName,
      error: "Album name must be 120 characters or fewer."
    };
  }

  return { ok: true, sanitizedName };
}

export function sanitizeFolderName(name: string): string {
  return name
    .trim()
    .replace(UNSUPPORTED_FOLDER_CHARACTERS, " ")
    .replace(WHITESPACE, " ")
    .trim();
}
