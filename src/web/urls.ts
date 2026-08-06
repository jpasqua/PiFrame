export function folderPhotosPath(folderId: string): string {
  return `/admin/folders/${encodeURIComponent(folderId)}/photos`;
}

export function settingsLocation(
  section: "general" | "presentation" | "schedule" | "folders" | "status",
  kind: "success" | "error",
  message: string
): string {
  return `/?view=${section}&${kind}=${encodeURIComponent(message)}`;
}
