declare module "claude-code" {
  interface PluginState {
    "file-picker": {
      dir: string;
      prevDir: string;
      showHidden: boolean;
      query: string;
      offset: number;
      preview: string;
      lineOffset: number;
      anchor: number;
      kept: { start: number; end: number }[];
      focusLine: number;
      confirm: string;
      confirmAction: string;
      marked: string[];
      search: boolean;
      walked: number;
      recentView: boolean;
      recent: { path: string; rel: string; name: string; size: number }[];
      peek: boolean;
      peeked: number;
    };
  }
}
