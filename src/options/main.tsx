import { createRoot } from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { OptionsApp } from "./OptionsApp";

createRoot(document.getElementById("root")!).render(
  <FluentProvider theme={webLightTheme}>
    <OptionsApp />
  </FluentProvider>
);
