import { createInertiaApp } from "@inertiajs/vue3";
import { createApp, h, type DefineComponent } from "vue";
import UsersIndex from "./pages/Users/Index.ts";

void createInertiaApp({
  resolve: (name) => {
    if (name === "Users/Index") {
      return UsersIndex as unknown as DefineComponent;
    }
    throw new Error(`Unknown Inertia page: ${name}`);
  },
  setup({ el, App, props, plugin }) {
    const app = createApp({ render: () => h(App, props) });
    app.use(plugin).mount(el!);
    return app;
  },
});
