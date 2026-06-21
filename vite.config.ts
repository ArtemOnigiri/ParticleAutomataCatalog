import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  base: "/ParticleAutomataCatalog/",
  plugins: [solid()],
});
