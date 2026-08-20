import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import { bettersLightTheme } from "./theme";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <FluentProvider theme={bettersLightTheme}>
    <App />
  </FluentProvider>
);
