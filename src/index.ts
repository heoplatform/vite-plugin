import { BaseHooks } from "base-plugin-system";
import { type ExpressHooks } from "express-plugin";
import express from "express";
import { createServer, ViteDevServer, type InlineConfig } from "vite";
import fs from "fs";
import fsAsync from "fs/promises";

export interface VitePluginConfig {
  /**
   * The vite config to use.
   */
  config: InlineConfig;
  /**
   * The modules that are used to generate the client plugin manager.
   */
  clientPluginModules: string[];
  /**
   * The modules that are used to generate the server plugin manager.
   */
  serverPluginModules: string[];
}

type MaybePromise<T> = T | Promise<T>;

export type InitVite = {
  getClientPluginManager: () => Promise<any[]>;
  getServerPluginManager: () => Promise<any[]>;
  generateHTMLTemplate: (url: string, head: string, body: string) => Promise<string>;
} & ({
  mode: "dev";
  server: ViteDevServer;
} | {
  mode: "prod";
})

export interface ViteHooks {
  configureVite?: (config: VitePluginConfig) => MaybePromise<VitePluginConfig>;
  initVite?: (vite: InitVite) => MaybePromise<void>;
}

export interface SSRBaseHooks {
  init: (serverPlugins: any[], clientPlugins: any[]) => MaybePromise<void>;
  postInit: () => MaybePromise<void>;
}

function pluginHasViteHooks(plugin: any): plugin is ViteHooks {
  return "configureVite" in plugin || "initVite" in plugin;
}

function createViteEnvironment(viteConfig: VitePluginConfig) {
  const viteDir = './.vite';
  
  // Create .vite directory if it doesn't exist
  if (!fs.existsSync(viteDir)) {
    fs.mkdirSync(viteDir, { recursive: true });
  }

  // Create vite.config.js
  fs.writeFileSync(`${viteDir}/vite.config.js`, `export default {}`);

  // Create index.html
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <!--app-head-->
  </head>
  <body>
    <div id="app"><!--app-html--></div>
    <script type="module" src="./client.ts"></script>
  </body>
</html>`;

  const serverModuleMap = Object.fromEntries(viteConfig.serverPluginModules.map((p, i) => ["plugin" + i, p]));

  const serverTs = `import clientPlugins from './client.ts';
${Object.entries(serverModuleMap).map(([key, value]) => `import ${key} from '${value}';`).join("\n")}

const serverPlugins = [${Object.keys(serverModuleMap).map(key => `${key}()`).join(", ")}];
for (const plugin of serverPlugins) {
  if (plugin.init) {
    await plugin.init(serverPlugins, clientPlugins);
  }
}
for (const plugin of serverPlugins) {
  if (plugin.postInit) {
    await plugin.postInit();
  }
}

export default serverPlugins;`;

  const clientModuleMap = Object.fromEntries(viteConfig.clientPluginModules.map((p, i) => ["plugin" + i, p]));

  const clientTs = `import { initPlugins } from 'base-plugin-system';
${Object.entries(clientModuleMap).map(([key, value]) => `import ${key} from '${value}';`).join("\n")}

const clientPlugins = [${Object.keys(clientModuleMap).map(key => `${key}()`).join(", ")}];
await initPlugins(clientPlugins);

export default clientPlugins;`;
  fs.writeFileSync(`${viteDir}/index.html`, indexHtml);
  fs.writeFileSync(`${viteDir}/client.ts`, clientTs);
  fs.writeFileSync(`${viteDir}/server.ts`, serverTs);
}

function isTruthy<T>(value: T): value is NonNullable<T> {
  return Boolean(value);
}

function vitePlugin(): BaseHooks & ExpressHooks {
  let plugins: any[] = [];
  let vite: ViteDevServer;
  let router: express.Router = express.Router();
  const isProduction = process.env.NODE_ENV === "production";
  
  return {
    init: async (_plugins) => {
      plugins = _plugins;
    },
    postInit: async () => {

    },
    initExpress: async (app) => {
      const relevantPlugins = plugins.filter(pluginHasViteHooks);
      const configureViteHooks = relevantPlugins.map((p) => p.configureVite).filter(isTruthy);
      const initViteHooks = relevantPlugins.map((p) => p.initVite).filter(isTruthy);

      let viteConfig: VitePluginConfig = {
        config: {
          server: { middlewareMode: true },
          appType: "custom",
          root: "./.vite",
          base: "/",
          optimizeDeps: {
            exclude: ['express']
          },
          plugins: [
            
          ]
        },
        clientPluginModules: [],
        serverPluginModules: [],
      };

      for (const hook of configureViteHooks) {
        viteConfig = await hook(viteConfig);
      }

      createViteEnvironment(viteConfig);
      if (!isProduction) {
        vite = await createServer(viteConfig.config);
        router.use(vite.middlewares);
      } else {
        const compression = (await import("compression")).default;
        const sirv = (await import("sirv")).default;
        router.use(compression());
        router.use("/", sirv("./dist/client", { extensions: [] }));
      }

      app.use(router);

      async function getClientPluginManager() {
        const clientPluginManager = await vite.ssrLoadModule("/client.ts").then((m) => m.default) as any;
        return clientPluginManager;
      }

      async function getServerPluginManager() {
        const serverPluginManager = await vite.ssrLoadModule("/server.ts").then((m) => m.default) as any;
        return serverPluginManager;
      }

      // Cached distribution assets
      const templateHtmlPromise = isProduction
      ? fsAsync.readFile("./dist/client/index.html", "utf-8")
      : undefined;

      async function generateHTMLTemplate(url: string, head: string, body: string) {
        let template = "";
        
        if (vite) {
          const unProcessedTemplate = await fsAsync.readFile("./.vite/index.html", "utf-8");
          template = await vite.transformIndexHtml(url, unProcessedTemplate);
        } else {
          template = templateHtmlPromise ? await templateHtmlPromise : "";
        }
        return template.replace("<!--app-head-->", head).replace("<!--app-html-->", body);
      }

      for (const hook of initViteHooks) {
        await hook({
          getClientPluginManager,
          mode: isProduction ? "prod" : "dev",
          server: vite,
          getServerPluginManager,
          generateHTMLTemplate,
        });
      }
    },
  };
}

export { vitePlugin };