import { createInertiaApp } from "@inertiajs/react";
import { createRoot } from "react-dom/client";
import UsersIndex from "./pages/Users/Index.tsx";

void createInertiaApp({
  resolve: (name) => {
    if (name === "Users/Index") {
      return UsersIndex;
    }
    throw new Error(`Unknown Inertia page: ${name}`);
  },
  setup({ el, App, props }) {
    createRoot(el).render(<App {...props} />);
  },
});
