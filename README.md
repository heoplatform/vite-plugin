# Vite Plugin

A Vite.js plugin for the base plugin system that provides modern frontend development with hot module replacement, server-side rendering (SSR), and seamless integration between client and server plugins.

## Features

- **Development Server**: Vite dev server with hot module replacement (HMR)
- **Production Builds**: Optimized builds with SSR support
- **Dual Plugin System**: Separate client and server plugin management
- **Express Integration**: Works seamlessly with the Express plugin
- **SSR Support**: Server-side rendering with hydration
- **Hot Reload**: Automatic plugin reloading during development
- **Build Commands**: Support for build and preview modes
- **Template Generation**: Dynamic HTML template generation
- **Static Asset Serving**: Production-ready static file serving

## Installation

```bash
npm install @heoplatform/vite-plugin
```

## API

### ViteHooks Interface

```typescript
interface ViteHooks {
  configureVite?: (config: VitePluginConfig) => MaybePromise<VitePluginConfig>;
  initVite?: (vite: InitVite) => MaybePromise<void>;
  postInitVite?: () => MaybePromse<void>;
}
```

### VitePluginConfig Interface

```typescript
interface VitePluginConfig {
  config: InlineConfig;           // Vite configuration
  clientPluginModules: string[];  // Client-side plugin modules
  serverPluginModules: string[];  // Server-side plugin modules
}
```

### InitVite Interface

```typescript
type InitVite = {
  generateHTMLTemplate: (url: string, head: string, body: string) => Promise<string>;
} & ({
  mode: "dev";
  server: ViteDevServer;
} | {
  mode: "prod";
})
```

### SSRBaseHooks Interface

```typescript
interface SSRBaseHooks {
  init?: (plugins: any[], vite: InitVite) => MaybePromise<void>;
  postInit?: () => MaybePromise<void>;
}
```

### ClientBaseHooks Interface

```typescript
interface SSRBaseHooks {
  init?: (plugins: any[], vite?: InitVite) => MaybePromise<void>;
  postInit?: () => MaybePromise<void>;
}
```

## Usage

### Basic Setup

To use the vite plugin, create a bootstrap plugin which has the vite plugin as a runtime dependency (see base plugin system docs). Then implement the ViteHooks interface. Client modules should implement ClientBaseHooks, and server modules should implement SSRBaseHooks.

The bootstrap plugin:

```ts
import { vitePlugin } from '@heoplatform/vite-plugin';
import solid from 'vite-plugin-solid'

function solidExamplePlugin() {
  let plugins = [];
  let currentMiddleware;
  return {
    name: "solid-example-boot",
    init: async (_plugins) => {
      plugins = _plugins;
      if (!plugins.find((p) => p.name === "vite")) {
        const vite = vitePlugin();
        plugins.push(vite);
        await vite.init?.(plugins);
      }
    },
    configureVite: async (vite) => {
      vite.clientPluginModules.push("@heoplatform/solid-example-plugin/client");
      vite.serverPluginModules.push("@heoplatform/solid-example-plugin/server");
      
      if (!vite.config.plugins) vite.config.plugins = [];
      vite.config.plugins.push(solid({ssr: true}));

      return vite;
    },
    initVite: async () => {
    },
    initExpress: async (express) => {
      express.use((req, res, next) => {
        if (currentMiddleware) {
          currentMiddleware(req, res, next);
        } else {
          next();
        }
      });
    },
    initSolidExampleServer: (middleware) => {
      currentMiddleware = middleware;
    }
  };
}

export { solidExamplePlugin as default };
```

The server plugin:

```tsx
import { Request, RequestHandler, Response, Router } from "express";
import { ServerData } from "@heoplatform/solid-plugin/server";
import { InitVite, SSRBaseHooks, ViteHooks } from "@heoplatform/vite-plugin";
import { generateHydrationScript, renderToStringAsync } from "solid-js/web";
import SecondExample from "../client/SecondExample.jsx";

interface SolidExampleServerPlugin extends SSRBaseHooks, ViteHooks {
  name: "solid-example-server";
}

export interface SolidExampleServerHooks {
  initSolidExampleServer: (middleware: RequestHandler) => void
}

export default function SolidServerPlugin(): SolidExampleServerPlugin {
  let plugins!: any[];
  let vite: InitVite;
  return {
    name: "solid-example-server",
    init: async (_plugins) => {
      plugins = _plugins;
    },
    postInit: async (_vite) => {
      vite = _vite;
      const router = Router();

      router.get("/api", (req, res) => {
        res.send("Hello World")
      })

      router.get("/test", async (req, res) => {
        const response = await fetch("https://jsonplaceholder.typicode.com/posts/1")
        const json = await response.json()
        const title = json.title

        res.send(`<!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Document</title>
            ${await vite.generateHeadContent()}
            ${generateHydrationScript()}
            ${vite.preload([await import("../client/SecondExample.jsx?url").then(m=>m.default)])}
            <script id="solid-example-data" type="application/json">${JSON.stringify({title})}</script>
          </head>
          <body>
            <div id="root">${await renderToStringAsync(() => <SecondExample title={title} />)}</div>
          </body>
        </html>`)
      })

      const relevantPlugins = plugins.filter((plugin): plugin is SolidExampleServerHooks => plugin.initSolidExampleServer);
      relevantPlugins.forEach((plugin) => plugin.initSolidExampleServer(router));
    }
  }
}
```

The client plugin:

```ts
import { type ClientBaseHooks } from "@heoplatform/vite-plugin";

interface SolidExampleClientHooks extends ClientBaseHooks {
  name: "solid-example-client";
}

export default function solidExampleClient(): SolidExampleClientHooks {
  let plugins: any[] = [];
  
  return {
    name: "solid-example-client",
    init: async (_plugins) => {
      plugins = _plugins;
    },
    postInit: async () => {
      if (import.meta.env.SSR) {
        return;
      }
      const jsonData = document.getElementById("solid-example-data")?.textContent!
      if (!jsonData) {
        return;
      }

      const parsed = JSON.parse(jsonData);

      const { hydrate, createComponent } = await import("solid-js/web");

      const SecondExample = await import("./SecondExample.js").then(m=>m.default);

      hydrate(() => createComponent(SecondExample, {title: parsed.title}), document.getElementById("root")!);
    }
  }
}
```

### Development Commands

```bash
# Development server (default)
node server.js

# Production build
node server.js --build

# Preview production build
node server.js --preview
```

### Examples

As mentioned above, the solid example plugin is a great example of this vite plugin in action!

## Internal structure

### File structure

The Vite plugin automatically creates a `.vite` directory with the following structure:

```
.vite/
├── index.html          # HTML template that loads client.ts
├── client.ts           # Client-side entry point
├── clientPlugins.ts    # Client plugin manager
├── server.ts           # Server plugin manager
├── vite.config.js      # Vite configuration
└── dist/               # Production builds
    ├── client/         # Client-side build
    └── server/         # SSR build
```

### HMR system

The Vite plugin includes an automatic hot reload system that dynamically reloads client and server plugins

1. File change detected
2. Remove plugins marked with `_vitePlugin` flag
3. Reload plugin modules
4. Reinitialize plugins with current plugin array
5. Update browser via HMR