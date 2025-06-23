import path from "path";
import type { ViteDevServer } from "vite";
import fs from "fs";

const cwd = process.cwd();
const manifest = fs.existsSync(path.join(cwd, ".vite/dist/client/.vite/ssr-manifest.json")) ? fs.readFileSync(path.join(cwd, ".vite/dist/client/.vite/ssr-manifest.json"), "utf-8") : "{}";
const manifestJson: Record<string, string[]> = Object.fromEntries(Object.entries(JSON.parse(manifest)).map(([key, value]) => [path.join(cwd, ".vite", key), value])) as any;

function collectDepsDev(viteDevServer: ViteDevServer, entryId: string, seen = new Set<string>()): Set<string> {
  const mod = viteDevServer.moduleGraph.getModuleById(entryId);
  if (!mod || !mod.id || seen.has(mod.id)) return seen;
  
  seen.add(mod.id);
  
  // Recursively collect dependencies
  for (const dep of mod.importedModules) {
    if (dep.id) {
      collectDepsDev(viteDevServer, dep.id, seen);
    }
  }
  
  return seen;
}

function getOptimizedUrl(id: string): string {
  // Check if this is already an optimized dependency URL
  if (id.startsWith('/@id/') || id.startsWith('/@fs/') || id.startsWith('/node_modules/.vite/deps/')) {
    return id;
  }
  
  // Check if this module corresponds to an optimized dependency
  // Optimized deps are typically stored in node_modules/.vite/deps/
  if (id.includes('node_modules') && !id.includes('.vite/deps')) {
    // Try to find if there's a corresponding optimized version
    // This is a heuristic - in a real implementation you'd want to check the actual optimizer state
    const packageName = extractPackageName(id);
    if (packageName) {
      // Check if this package was optimized by looking for it in the deps directory
      const optimizedPath = `/node_modules/.vite/deps/${packageName}.js`;
      return optimizedPath;
    }
  }
  
  // For regular file paths, use /@fs/ prefix
  return path.join("/@fs/", id);
}

function extractPackageName(filePath: string): string | null {
  const nodeModulesIndex = filePath.lastIndexOf('node_modules/');
  if (nodeModulesIndex === -1) return null;
  
  const afterNodeModules = filePath.substring(nodeModulesIndex + 'node_modules/'.length);
  const parts = afterNodeModules.split('/');
  
  // Handle scoped packages like @vue/shared
  if (parts[0].startsWith('@')) {
    return parts.length > 1 ? `${parts[0]}_${parts[1]}` : parts[0];
  }
  
  return parts[0];
}

export function getDeps(modules: string[], viteDevServer?: ViteDevServer, isProduction: boolean = false) {
  let deps: string[] = [];

  modules = modules.map(module => {
    if (module.startsWith("/@fs/")) {
      return module.slice(4);
    } else if (module.startsWith("file://")) {
      return module.slice(7);
    } else {
      return module;
    }
  })
  
  for (const module of modules) {
    if (isProduction) { 
      const manifestModules = manifestJson[module];
      if (manifestModules) {
        deps.push(...manifestModules);
      }
    } else if (viteDevServer) {
      try {
        const depsDev = collectDepsDev(viteDevServer, module);
        if (depsDev && depsDev.size > 0) {
          const assets = [...depsDev].map(id => getOptimizedUrl(id));
          deps.push(...assets);
        }
      } catch (error) {
        console.warn(`Failed to collect dependencies for ${module}:`, error);
      }
    }
  }
  
  return [...new Set(deps)];
}