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
      confirm: string;
      confirmAction: string;
    };
  }
}
