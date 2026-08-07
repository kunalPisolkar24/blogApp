import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: [
    "../services/user/schema.graphql",
    "../services/content/graph/schema.graphqls",
  ],
  documents: ["src/**/*.{graphql,ts,tsx}", "!src/shared/graphql/generated/**/*"],
  generates: {
    "./src/shared/graphql/generated/": {
      preset: "client",
      presetConfig: {
        fragmentMasking: false,
      },
      plugins: [],
    },
  },
  ignoreNoDocuments: false,
};

export default config;
