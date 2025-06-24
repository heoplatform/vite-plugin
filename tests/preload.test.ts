import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import type { ViteDevServer, ModuleNode } from 'vite';
import path from 'path';

const { fsMock } = vi.hoisted(() => {
    return {
        fsMock: {
            existsSync: vi.fn(),
            readFileSync: vi.fn(),
        }
    }
});

// Mock fs module
vi.mock('fs', () => ({
    default: fsMock,
}));

// Mock path.join to control output
vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>();
  return {
    ...actual,
    join: actual.posix.join,
  };
});

// Helper to create mock ModuleNode-like object
function createMockModule(id: string | null, importedModules: Set<any> = new Set()) {
  return {
    id,
    importedModules,
  };
}

// Type for mock ViteDevServer to avoid strict typing issues
interface MockViteServer {
  moduleGraph: {
    getModuleById: (id: string) => any;
  };
}

describe('Preload Functionality', () => {
  const originalCwd = process.cwd();
  const mockCwd = '/mock/project';

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock process.cwd
    vi.spyOn(process, 'cwd').mockReturnValue(mockCwd);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Production Mode - Manifest-based preloading', () => {
    it('should load dependencies from manifest file in production', async () => {
      const mockManifest = {
        "client.ts": ["assets/client-abc123.js", "assets/vendor-def456.js"],
        "server.ts": ["assets/server-ghi789.js"]
      };
      
      vi.mocked(fsMock.existsSync).mockReturnValue(true);
      vi.mocked(fsMock.readFileSync).mockImplementation((p) => {
        if (p === path.join('/mock/project', ".vite/dist/client/.vite/ssr-manifest.json")) {
          return JSON.stringify(mockManifest);
        }
        return '{}';
      });
      
      vi.resetModules();
      const { getDeps } = await import('../src/preload.js');
      
      const result = getDeps(['/mock/project/.vite/client.ts'], undefined);
      
      expect(result).toEqual(['assets/client-abc123.js', 'assets/vendor-def456.js']);
    });

    it('should return empty array for modules not in manifest', async () => {
      const mockManifest = {
        "client.ts": ["assets/client-abc123.js"]
      };
      
      vi.mocked(fsMock.existsSync).mockReturnValue(true);
      vi.mocked(fsMock.readFileSync).mockImplementation((p) => {
        if (p === path.join('/mock/project', ".vite/dist/client/.vite/ssr-manifest.json")) {
          return JSON.stringify(mockManifest);
        }
        return '{}';
      });
      vi.resetModules();
      const { getDeps } = await import('../src/preload.js');
      
      const result = getDeps(['/mock/project/.vite/nonexistent.ts'], undefined);
      
      expect(result).toEqual([]);
    });

    it('should handle multiple modules in production', async () => {
      const mockManifest = {
        "client.ts": ["assets/client-abc123.js", "assets/shared-xyz789.js"],
        "admin.ts": ["assets/admin-def456.js", "assets/shared-xyz789.js"]
      };
      
      vi.mocked(fsMock.existsSync).mockReturnValue(true);
      vi.mocked(fsMock.readFileSync).mockImplementation((p) => {
        if (p === path.join('/mock/project', ".vite/dist/client/.vite/ssr-manifest.json")) {
          return JSON.stringify(mockManifest);
        }
        return '{}';
      });
      vi.resetModules();
      const { getDeps } = await import('../src/preload.js');
      
      const result = getDeps([
        '/mock/project/.vite/client.ts', 
        '/mock/project/.vite/admin.ts'
      ], undefined);
      
      // Should deduplicate shared dependencies
      expect(result).toEqual([
        'assets/client-abc123.js',
        'assets/shared-xyz789.js',
        'assets/admin-def456.js'
      ]);
    });

    it('should handle empty manifest file', async () => {
      vi.mocked(fsMock.existsSync).mockReturnValue(true);
      vi.mocked(fsMock.readFileSync).mockImplementation((p) => {
        if (p === path.join('/mock/project', ".vite/dist/client/.vite/ssr-manifest.json")) {
          return '{}';
        }
        return '{}';
      });
      vi.resetModules();
      const { getDeps } = await import('../src/preload.js');
      
      const result = getDeps(['/mock/project/.vite/client.ts'], undefined);
      
      expect(result).toEqual([]);
    });

    it('should handle missing manifest file', async () => {
      vi.mocked(fsMock.existsSync).mockReturnValue(false);
      vi.resetModules();
      const { getDeps } = await import('../src/preload.js');
      
      const result = getDeps(['/mock/project/.vite/client.ts'], undefined);
      
      expect(result).toEqual([]);
    });
  });

  describe('Development Mode - Vite module graph preloading', () => {
    let mockViteServer: MockViteServer;
    let mockModule: any;
    let mockDep1: any;
    let mockDep2: any;

    beforeEach(() => {
      // Setup mock Vite module dependencies
      mockDep2 = createMockModule('/src/utils/helper.ts');
      mockDep1 = createMockModule('/src/components/Button.tsx', new Set([mockDep2]));
      mockModule = createMockModule('/src/main.ts', new Set([mockDep1]));

      mockViteServer = {
        moduleGraph: {
          getModuleById: vi.fn((id: string) => {
            if (id === '/src/main.ts') return mockModule;
            if (id === '/src/components/Button.tsx') return mockDep1;
            if (id === '/src/utils/helper.ts') return mockDep2;
            return undefined;
          })
        }
      };

      // Mock manifest file doesn't exist for dev mode
      vi.mocked(fsMock.existsSync).mockReturnValue(false);
      vi.resetModules();
    });

    it('should collect dependencies recursively in development', async () => {
      const { getDeps } = await import('../src/preload.js');
      const result = getDeps(['/src/main.ts'], mockViteServer as any);
      
      expect(result).toEqual([
        '/@fs/src/main.ts',
        '/@fs/src/components/Button.tsx',
        '/@fs/src/utils/helper.ts'
      ]);
    });

    it('should handle circular dependencies without infinite loops', async () => {
      // Create circular dependency: main -> button -> main
      mockDep1.importedModules.add(mockModule);
      
      const { getDeps } = await import('../src/preload.js');
      const result = getDeps(['/src/main.ts'], mockViteServer as any);
      
      // Should still complete and not get stuck in infinite loop
      expect(result).toContain('/@fs/src/main.ts');
      expect(result).toContain('/@fs/src/components/Button.tsx');
    });

    it('should handle modules with no dependencies', async () => {
      const standaloneModule = createMockModule('/src/standalone.ts');

      vi.mocked(mockViteServer.moduleGraph.getModuleById).mockImplementation((id: string) => {
        if (id === '/src/standalone.ts') return standaloneModule;
        return undefined;
      });

      const { getDeps } = await import('../src/preload.js');
      const result = getDeps(['/src/standalone.ts'], mockViteServer as any);
      
      expect(result).toEqual(['/@fs/src/standalone.ts']);
    });

    it('should handle non-existent modules gracefully', async () => {
      vi.mocked(mockViteServer.moduleGraph.getModuleById).mockReturnValue(undefined);
      
      const { getDeps } = await import('../src/preload.js');
      const result = getDeps(['/src/nonexistent.ts'], mockViteServer as any);
      
      expect(result).toEqual([]);
    });

    it('should handle modules without IDs', async () => {
      const moduleWithoutId = createMockModule(null, new Set());

      vi.mocked(mockViteServer.moduleGraph.getModuleById).mockReturnValue(moduleWithoutId);
      
      const { getDeps } = await import('../src/preload.js');
      const result = getDeps(['/src/test.ts'], mockViteServer as any);
      
      expect(result).toEqual([]);
    });

    it('should handle errors during dependency collection', async () => {
      vi.mocked(mockViteServer.moduleGraph.getModuleById).mockImplementation(() => {
        throw new Error('Module graph error');
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const { getDeps } = await import('../src/preload.js');
      const result = getDeps(['/src/error.ts'], mockViteServer as any,);
      
      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to collect dependencies for /src/error.ts:',
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('URL transformation and optimization', () => {
    beforeEach(() => {
      vi.mocked(fsMock.existsSync).mockReturnValue(false);
      vi.resetModules();
    });

    it('should handle /@fs/ prefixed modules', async () => {
      const { getDeps } = await import('../src/preload.js');
      const result = getDeps(['/@fs/absolute/path/to/file.ts'], undefined);
      
      // Should strip /@fs/ prefix during processing, but getDeps doesn't have viteServer so returns empty
      expect(result).toEqual([]);
    });

    it('should handle file:// prefixed modules', async () => {
      const { getDeps } = await import('../src/preload.js');
      const result = getDeps(['file:///absolute/path/to/file.ts'], undefined);
      
      // Should strip file:// prefix during processing
      expect(result).toEqual([]);
    });

    it('should handle regular file paths', async () => {
      const { getDeps } = await import('../src/preload.js');
      const result = getDeps(['/regular/path/to/file.ts'], undefined);
      
      // Without viteServer, should return empty array
      expect(result).toEqual([]);
    });

    it('should deduplicate dependencies', async () => {
      const mockManifest = {
        "client.ts": ["assets/shared-abc123.js", "assets/client-def456.js"],
        "admin.ts": ["assets/shared-abc123.js", "assets/admin-ghi789.js"]
      };
      
      vi.mocked(fsMock.existsSync).mockReturnValue(true);
      vi.mocked(fsMock.readFileSync).mockImplementation((p) => {
        if (p === path.join('/mock/project', ".vite/dist/client/.vite/ssr-manifest.json")) {
          return JSON.stringify(mockManifest);
        }
        return '{}';
      });
      vi.resetModules();
      const { getDeps } = await import('../src/preload.js');
      
      const result = getDeps([
        '/mock/project/.vite/client.ts',
        '/mock/project/.vite/admin.ts'
      ], undefined);
      
      // Should deduplicate shared-abc123.js
      expect(result).toEqual([
        'assets/shared-abc123.js',
        'assets/client-def456.js',
        'assets/admin-ghi789.js'
      ]);
    });

    it('should optimize node_modules URLs in development', async () => {
      const nodeModuleDep = createMockModule('/project/node_modules/lodash/index.js');

      const mockViteServer: MockViteServer = {
        moduleGraph: {
          getModuleById: vi.fn((id: string) => {
            if (id === '/project/node_modules/lodash/index.js') return nodeModuleDep;
            return undefined;
          })
        }
      };
      vi.resetModules();
      const { getDeps } = await import('../src/preload.js');

      const result = getDeps(['/project/node_modules/lodash/index.js'], mockViteServer as any);
      
      expect(result).toEqual(['/node_modules/.vite/deps/lodash.js']);
    });

    it('should handle scoped packages in node_modules', async () => {
      const scopedDep = createMockModule('/project/node_modules/@vue/shared/index.js');

      const mockViteServer: MockViteServer = {
        moduleGraph: {
          getModuleById: vi.fn((id: string) => {
            if (id === '/project/node_modules/@vue/shared/index.js') return scopedDep;
            return undefined;
          })
        }
      };
      vi.resetModules();
      const { getDeps } = await import('../src/preload.js');

      const result = getDeps(['/project/node_modules/@vue/shared/index.js'], mockViteServer as any);
      
      expect(result).toEqual(['/node_modules/.vite/deps/@vue_shared.js']);
    });

    it('should preserve already optimized URLs', async () => {
      const optimizedDep = createMockModule('/@id/virtual:my-plugin');

      const mockViteServer: MockViteServer = {
        moduleGraph: {
          getModuleById: vi.fn((id: string) => {
            if (id === '/@id/virtual:my-plugin') return optimizedDep;
            return undefined;
          })
        }
      };
      vi.resetModules();
      const { getDeps } = await import('../src/preload.js');

      const result = getDeps(['/@id/virtual:my-plugin'], mockViteServer as any);
      
      expect(result).toEqual(['/@id/virtual:my-plugin']);
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle empty module list', async () => {
      vi.resetModules();
      const { getDeps } = await import('../src/preload.js');
      const result = getDeps([], undefined);
      
      expect(result).toEqual([]);
    });

    it('should handle undefined viteServer in development mode', async () => {
      vi.mocked(fsMock.existsSync).mockReturnValue(false);
      vi.resetModules();
      const { getDeps } = await import('../src/preload.js');
      
      const result = getDeps(['/src/main.ts'], undefined);
      
      expect(result).toEqual([]);
    });

    it('should handle malformed manifest JSON', async () => {
      vi.mocked(fsMock.existsSync).mockReturnValue(true);
      vi.mocked(fsMock.readFileSync).mockReturnValue('invalid json {');
      
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      vi.resetModules();
      const { getDeps } = await import('../src/preload.js');
      getDeps([], undefined);
      
      expect(consoleSpy).toHaveBeenCalledWith("Failed to parse ssr-manifest.json", expect.any(Error));
      
      consoleSpy.mockRestore();
    });

    it('should handle modules with mixed URL formats', async () => {
      vi.resetModules();
      const { getDeps } = await import('../src/preload.js');
      const result = getDeps([
        '/@fs/absolute/path/file1.ts',
        'file:///absolute/path/file2.ts',
        '/regular/path/file3.ts'
      ], undefined);
      
      // Without viteServer, should return empty array
      expect(result).toEqual([]);
    });
  });

  describe('Integration scenarios', () => {
    it('should work with complex dependency tree', async () => {
      // Create a complex dependency tree
      const deepDep = createMockModule('/src/utils/deep.ts');
      const sharedDep = createMockModule('/src/shared/common.ts', new Set([deepDep]));
      const component1 = createMockModule('/src/components/Header.tsx', new Set([sharedDep]));
      const component2 = createMockModule('/src/components/Footer.tsx', new Set([sharedDep]));
      const mainModule = createMockModule('/src/app.ts', new Set([component1, component2]));

      const mockViteServer: MockViteServer = {
        moduleGraph: {
          getModuleById: vi.fn((id: string) => {
            const modules: Record<string, any> = {
              '/src/app.ts': mainModule,
              '/src/components/Header.tsx': component1,
              '/src/components/Footer.tsx': component2,
              '/src/shared/common.ts': sharedDep,
              '/src/utils/deep.ts': deepDep
            };
            return modules[id] || undefined;
          })
        }
      };

      vi.mocked(fsMock.existsSync).mockReturnValue(false);
      vi.resetModules();
      const { getDeps } = await import('../src/preload.js');

      const result = getDeps(['/src/app.ts'], mockViteServer as any);
      
      // Should collect all dependencies and deduplicate shared ones
      expect(result).toContain('/@fs/src/app.ts');
      expect(result).toContain('/@fs/src/components/Header.tsx');
      expect(result).toContain('/@fs/src/components/Footer.tsx');
      expect(result).toContain('/@fs/src/shared/common.ts');
      expect(result).toContain('/@fs/src/utils/deep.ts');
      
      // Should not have duplicates
      expect(result.length).toBe(new Set(result).size);
    });

    it('should handle production mode with complex manifest', async () => {
      const complexManifest = {
        "main.ts": [
          "assets/vendor-react.abc123.js",
          "assets/vendor-lodash.def456.js",
          "assets/main.ghi789.js"
        ],
        "admin.ts": [
          "assets/vendor-react.abc123.js", // Shared with main
          "assets/vendor-chart.jkl012.js",
          "assets/admin.mno345.js"
        ],
        "worker.ts": [
          "assets/worker.pqr678.js"
        ]
      };

      vi.mocked(fsMock.existsSync).mockReturnValue(true);
      vi.mocked(fsMock.readFileSync).mockImplementation((p) => {
        if (p === path.join('/mock/project', ".vite/dist/client/.vite/ssr-manifest.json")) {
          return JSON.stringify(complexManifest);
        }
        return '{}';
      });
      vi.resetModules();
      const { getDeps } = await import('../src/preload.js');

      const result = getDeps([
        '/mock/project/.vite/main.ts',
        '/mock/project/.vite/admin.ts',
        '/mock/project/.vite/worker.ts'
      ], undefined);

      expect(result).toEqual([
        'assets/vendor-react.abc123.js',
        'assets/vendor-lodash.def456.js',
        'assets/main.ghi789.js',
        'assets/vendor-chart.jkl012.js',
        'assets/admin.mno345.js',
        'assets/worker.pqr678.js'
      ]);
    });
  });
}); 