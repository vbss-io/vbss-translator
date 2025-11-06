import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import dts from "vite-plugin-dts";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => {
  const isCLIBuild = mode === "cli";
  const isGeneratorBuild = mode === "generator";
  if (isCLIBuild) {
    return {
      resolve: {
        alias: {
          "@": path.resolve(__dirname, "./src"),
        },
      },
      build: {
        lib: false,
        rollupOptions: {
          input: path.resolve(__dirname, "src/cli/index.ts"),
          external: (id) => {
            if (
              id.startsWith("node:") ||
              [
                "fs",
                "fs/promises",
                "path",
                "process",
                "util",
                "events",
                "stream",
                "string_decoder",
                "url",
                "glob",
              ].includes(id)
            ) {
              return true;
            }
            const nodeBuiltins = [
              "fs",
              "path",
              "process",
              "util",
              "events",
              "stream",
              "string_decoder",
              "url",
              "os",
              "crypto",
            ];
            if (nodeBuiltins.includes(id)) {
              return true;
            }
            if (id === "glob" || id.startsWith("glob/")) {
              return true;
            }
            return false;
          },
          output: {
            dir: path.resolve(__dirname, "dist/cli"),
            entryFileNames: "index.js",
            format: "es",
          },
        },
        target: "node18",
        outDir: "dist",
        emptyOutDir: false,
      },
      plugins: [tsconfigPaths()],
    };
  }
  if (isGeneratorBuild) {
    return {
      resolve: {
        alias: {
          "@": path.resolve(__dirname, "./src"),
        },
      },
      build: {
        emptyOutDir: false,
        lib: {
          entry: path.resolve(__dirname, "src/generator.ts"),
          name: "vbss-translator-generator",
          fileName: "generator",
        },
        rollupOptions: {
          external: [
            /^node:/,
            "fs",
            "fs/promises", 
            "path",
            "glob"
          ],
          output: [
            {
              format: 'es',
              entryFileNames: 'generator.js',
            },
            {
              format: 'cjs',
              entryFileNames: 'generator.cjs',
            },
          ],
        },
      },
      plugins: [
        dts({ 
          rollupTypes: false,
          exclude: ["src/cli/**", "src/index.ts"],
          entryRoot: "src",
          include: ["src/generator.ts"],
          outDir: "dist"
        })
      ],
    };
  }
  return {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      lib: {
        entry: path.resolve(__dirname, "src/index.ts"),
        name: "vbss/translator",
        fileName: "vbss-translator",
      },
      rollupOptions: {
        external: [
          "react", 
          "react-dom",
          /^node:/,
          "fs",
          "fs/promises", 
          "path",
          "glob"
        ],
        output: {
          globals: {
            react: "React",
            "react-dom": "ReactDOM",
          },
        },
      },
    },
    plugins: [
      react(), 
      dts({ 
        rollupTypes: true, 
        exclude: ["src/cli/**"],
        entryRoot: "src"
      })
    ],
  };
});
