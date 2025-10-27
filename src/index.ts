import { BaseHooks } from "@heoplatform/base-plugin-system";
import { ExpressPlugin, type ExpressHooks } from "@heoplatform/express-plugin";
import express from "express";
import { createServer, build, ViteDevServer, type InlineConfig } from "vite";
import fs from "fs";
import fsAsync from "fs/promises";
import minimist from "minimist";
import path from "path";
import { getDeps } from "./preload.js";

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
  /**
   * Opinionated. Generates a complete HTML template with custom head and body content injected.
   * Uses some sane defaults, albeit opinionated, such as UTF-8 and viewport meta tag.
   */
  generateHTMLTemplate: (url: string, head: string, body: string) => Promise<string>;
  /**
   * Unopinionated. Generates just the processed head content (everything between <head> tags).
   * This is a convenience function that internally calls generateHTMLTemplate 
   * with empty head/body and extracts only the head portion.
   */
  generateHeadContent: () => Promise<string>;
  /**
   * Returns the dependencies for the given modules. Useful for preloading modules.
   */
  getDeps: (modules: string[]) => string[];
  /**
   * The port that the server is running on. Inherited from the express plugin.
   */
  port: number;
} & ({
  mode: "dev";
  server: ViteDevServer;
} | {
  mode: "prod";
})

export interface ViteHooks {
  configureVite?: (config: VitePluginConfig) => MaybePromise<VitePluginConfig>;
  initVite?: (vite: InitVite) => MaybePromise<void>;
  postInitVite?: () => MaybePromise<void>;
}

export interface SSRBaseHooks {
  init?: (plugins: any[], vite: InitVite) => MaybePromise<void>;
  postInit?: () => MaybePromise<void>;
}

export interface ClientBaseHooks {
  init?: (plugins: any[], vite?: InitVite) => MaybePromise<void>;
  postInit?: () => MaybePromise<void>;
}

function pluginHasViteHooks(plugin: any): plugin is ViteHooks {
  return "configureVite" in plugin || "initVite" in plugin;
}

function createViteEnvironment(serverPluginModules: string[], clientPluginModules: string[]) {
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
    <!--app-head-->
    <script type="module" src="/client.ts"></script>
  </head>
  <body>
    <div id="app"><!--app-html--></div>
  </body>
</html>`;

  const serverModuleMap = Object.fromEntries(serverPluginModules.map((p, i) => ["plugin" + i, p]));

  const serverTs = `${Object.entries(serverModuleMap).map(([key, value]) => `import ${key} from '${value}';`).join("\n")}

const getServerPlugins = () => [${Object.keys(serverModuleMap).map(key => `${key}()`).join(", ")}];


export default getServerPlugins;`;

  const clientModuleMap = Object.fromEntries(clientPluginModules.map((p, i) => ["plugin" + i, p]));

  const clientPluginsTs = `${Object.entries(clientModuleMap).map(([key, value]) => `import ${key} from '${value}';`).join("\n")}

const getClientPlugins = () => [${Object.keys(clientModuleMap).map(key => `${key}()`).join(", ")}];

export default getClientPlugins;`;

const clientTs = `import { initPlugins } from '@heoplatform/base-plugin-system';
import getClientPlugins from './clientPlugins.ts';
initPlugins(getClientPlugins());`;


  fs.writeFileSync(`${viteDir}/index.html`, indexHtml);
  fs.writeFileSync(`${viteDir}/client.ts`, clientTs);
  fs.writeFileSync(`${viteDir}/clientPlugins.ts`, clientPluginsTs);
  fs.writeFileSync(`${viteDir}/server.ts`, serverTs);
}

function isTruthy<T>(value: T): value is NonNullable<T> {
  return Boolean(value);
}

async function getViteDevConfig(configureViteHooks: ((config: VitePluginConfig) => MaybePromise<VitePluginConfig>)[], reload: () => Promise<void>) {
  let viteConfig: VitePluginConfig = {
    config: {
      server: { middlewareMode: true },
      appType: "custom",
      root: "./.vite",
      base: "/",
      build: {
        target: "esnext",
      },
      optimizeDeps: {
        exclude: [
          'express',
          '@heoplatform/vite-plugin',
        ]
      },
      plugins: [
        {
          name: "vite-plugin-reload",
          handleHotUpdate: async (ctx) => {
            await reload();
          }
        }
      ]
    },
    clientPluginModules: [],
    serverPluginModules: [],
  };

  for (const hook of configureViteHooks) {
    viteConfig = await hook(viteConfig);
  }

  return viteConfig;
}

async function getViteProdConfig(ssr: boolean, configureViteHooks: ((config: VitePluginConfig) => MaybePromise<VitePluginConfig>)[]) {
  let viteConfig: VitePluginConfig = {
    config: {
      appType: "custom",
      root: "./.vite",
      base: "/",
      build: {
        rollupOptions: ssr ? {
          input: ["./.vite/server.ts", "./.vite/client.ts", "./.vite/clientPlugins.ts"],
        } : {
          
        },
        outDir: ssr ? "./dist/server" : "./dist/client",
        target: "esnext",
        ssrManifest: !ssr,
        ssr: ssr,
      },
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

  return viteConfig;
}


function vitePlugin(): BaseHooks & ExpressHooks & {name: "vite"} {
  let plugins: any[] = [];
  let vite: ViteDevServer;
  let router: express.Router = express.Router();
  let isProduction = process.env.NODE_ENV === "production";
  let app!: express.Application;
  let stop!: () => void;
  let templateHtmlPromise: Promise<string> | undefined;
  let initVite: InitVite;

  async function internalGenerateHTMLTemplate(url: string, head: string, body: string) {
    let template = "";
    
    if (vite) {
      const unProcessedTemplate = await fsAsync.readFile("./.vite/index.html", "utf-8");
      template = await vite.transformIndexHtml(url, unProcessedTemplate);
    } else {
      template = templateHtmlPromise ? await templateHtmlPromise : "";
    }
    const headSplit = template.split("<!--app-head-->");
    const piece1 = headSplit[0];
    const bodySplit = headSplit[1].split("<!--app-html-->");
    const piece2 = bodySplit[0];
    const piece3 = bodySplit[1];

    return piece1 + head + piece2 + body + piece3;
  }

  async function generateHTMLTemplate(url: string, head: string, body: string) {
    head = `<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />` + head;
    return internalGenerateHTMLTemplate(url, head, body);
  }

  async function generateHeadContent() {
    const htmlTemplate = await internalGenerateHTMLTemplate("/", "", "");
    return htmlTemplate.split("<head>")[1].split("</head>")[0];
  }

  function getRelevantHooks() {
    const relevantPlugins = plugins.filter(pluginHasViteHooks);
    const configureViteHooks = relevantPlugins.map((p) => p.configureVite).filter(isTruthy);
    const initViteHooks = relevantPlugins.map((p) => p.initVite).filter(isTruthy);
    const postInitViteHooks = relevantPlugins.map((p) => p.postInitVite).filter(isTruthy);
    return { configureViteHooks, initViteHooks, postInitViteHooks };
  }

  async function reloadPlugins() {
    for (let i = plugins.length - 1; i >= 0; i--) {
      if (plugins[i]._vitePlugin) {
        plugins.splice(i, 1);
      }
    }
    
    const cwd = process.cwd();
    const clientPluginModule = isProduction ? await import(path.join(cwd, "./.vite/dist/server/clientPlugins.js") as string) : await vite.ssrLoadModule("/clientPlugins.ts");
    const clientPluginManager: (ClientBaseHooks & {_vitePlugin: true})[] = clientPluginModule.default();

    const serverPluginModule = isProduction ? await import(path.join(cwd, "./.vite/dist/server/server.js") as string) : await vite.ssrLoadModule("/server.ts");
    const serverPluginManager: (SSRBaseHooks & {_vitePlugin: true})[] = serverPluginModule.default();

    plugins.push(...clientPluginManager);
    plugins.push(...serverPluginManager);

    for (const plugin of clientPluginManager) {
      plugin._vitePlugin = true;
      if (plugin.init) {
        await plugin.init(plugins, initVite);
      }
    }

    for (const plugin of serverPluginManager) {
      plugin._vitePlugin = true;
      if (plugin.init) {
        await plugin.init(plugins, initVite);
      }
    }

    for (const plugin of clientPluginManager) {
      if (plugin.postInit) {
        await plugin.postInit();
      }
    }

    for (const plugin of serverPluginManager) {
      if (plugin.postInit) {
        await plugin.postInit();
      }
    }
  }

  async function restartServer(configureViteHooks?: ((config: VitePluginConfig) => MaybePromise<VitePluginConfig>)[]) {
    if (!configureViteHooks) {
      configureViteHooks = getRelevantHooks().configureViteHooks;
    }
    if (!isProduction) {
      const viteConfig = await getViteDevConfig(configureViteHooks, reloadPlugins);
      createViteEnvironment(viteConfig.serverPluginModules, viteConfig.clientPluginModules);
      vite = await createServer(viteConfig.config);
      router.use(vite.middlewares);
    } else {
      const compression = (await import("compression")).default;
      const sirv = (await import("sirv")).default;
      router.use(compression());
      router.use("/", sirv("./.vite/dist/client", { extensions: [] }));
    }

    await reloadPlugins();
  }
  
  return {
    name: "vite",
    init: async (_plugins) => {
      plugins = _plugins;
    },
    initExpress: async (_app, _stop) => {
      app = _app;
      stop = _stop;

      const expressPlugin = plugins.find((p): p is ExpressPlugin => p.name === "express");
      const port = expressPlugin?.port ?? 5173;
      initVite = {
        get mode() { return isProduction ? "prod" : "dev" },
        get server() { return vite },
        generateHTMLTemplate,
        generateHeadContent,
        getDeps: (modules) => getDeps(modules, vite),
        port: port,
      } as InitVite;
    },
    postInitExpress: async () => {
      const args = minimist(process.argv.slice(2));

      const { configureViteHooks, initViteHooks, postInitViteHooks } = getRelevantHooks();

      if (args.build) {
        // no ssr
        const viteConfig = await getViteProdConfig(false, configureViteHooks);
        createViteEnvironment(viteConfig.serverPluginModules, viteConfig.clientPluginModules);
        
        await build(viteConfig.config);
        // ssr
        const viteConfigSSR = await getViteProdConfig(true, configureViteHooks);
        createViteEnvironment(viteConfigSSR.serverPluginModules, viteConfigSSR.clientPluginModules);
        await build(viteConfigSSR.config);

        stop();
        return;
      } else if (args.preview) {
        isProduction = true;
      }

      await restartServer(configureViteHooks);

      app.use(router);

      // Cached distribution assets
      templateHtmlPromise = isProduction
      ? fsAsync.readFile("./.vite/dist/client/index.html", "utf-8")
      : undefined;

      for (const hook of initViteHooks) {
        await hook(initVite);
      }

      for (const hook of postInitViteHooks) {
        await hook();
      }
    },
  };
}

export async function injectVite(plugins: any[]) {
  if (!plugins.find(p => p.name === "vite")) {
    const vite = vitePlugin()
    plugins.push(vite)
    await vite.init?.(plugins)
  }
}

export { vitePlugin };