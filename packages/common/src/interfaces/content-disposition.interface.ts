/** How a download presents itself: as a file to save, or as content to render. */
export interface DownloadFileOptions {
  /** `attachment` (the default) names a download; `inline` names a render. */
  readonly disposition?: "attachment" | "inline";
}
