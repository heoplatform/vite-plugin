# Vite Plugin

A comprehensive Vite.js plugin for the base plugin system that provides modern frontend development with hot module replacement, server-side rendering (SSR), and seamless integration between client and server plugins.

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
npm install vite
npm install @types/node  # If using TypeScript
```

## API

### ViteHooks Interface

```typescript
interface ViteHooks {
  configureVite?: (config: VitePluginConfig) => MaybePromise<VitePluginConfig>;
  initVite?: (vite: InitVite) => MaybePromise<void>;
}
```

- **`configureVite`**: Configure Vite settings and specify plugin modules
- **`initVite`**: Initialize when Vite is ready (receives dev server or prod mode info)

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
  init?: (plugins: any[]) => MaybePromise<void>;
  postInit?: (vite: InitVite) => MaybePromise<void>;
}
```

## Usage

### Basic Setup

To use the vite plugin, simply create a plugin which has the vite plugin as a runtime dependency (see base plugin system docs). Then implement the ViteHooks interface. Client modules should implement BaseHooks, and server modules should implement SSRBaseHooks.

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

An awesome example of this plugin in action is the core-svelte plugin. If you wish to create a plugin for a different framework, then you should definitely take notes from the core-svelte plugin.

## File Structure

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

## Build Process

### Development Mode
1. Creates `.vite` environment
2. Starts Vite dev server with middleware mode
3. Enables hot module replacement
4. Loads and initializes client/server plugins dynamically

### Production Build Mode
1. Builds client-side bundle
2. Builds server-side bundle for SSR
3. Generates optimized assets

### Preview Mode
1. Uses production builds
2. Serves static files with compression
3. Enables SSR functionality

## Hot Reload System

The Vite plugin includes an automatic hot reload system that:

1. **Detects Changes**: Monitors file changes through Vite's HMR
2. **Reloads Plugins**: Dynamically reloads client and server plugins
3. **Updates Browser**: Automatically updates the browser via HMR

### Plugin Reload Lifecycle

1. File change detected
2. Remove plugins marked with `_vitePlugin` flag
3. Reload plugin modules
4. Reinitialize plugins with current plugin array
5. Update browser via HMR

## Environment Variables

- **`NODE_ENV`**: Set to "production" for production mode
- **`PORT`**: Server port (inherited from Express plugin)

## CLI Arguments

- **`--build`**: Build for production and exit
- **`--preview`**: Run in preview mode (production build serving)

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 