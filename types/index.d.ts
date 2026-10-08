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
      focusLine: number;
      confirm: string;
      confirmAction: string;
      marked: string[];
      search: boolean;
      walked: number;
      peek: boolean;
      peeked: number;
    };
  }
}
