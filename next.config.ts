import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Páginas leem o cache local (data/cache) a cada requisição; sem Cache Components por ora.
  // data/ é lido via fs em tempo de execução: precisa ir junto no pacote das funções da Vercel
  outputFileTracingIncludes: {
    "/**": ["./data/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
