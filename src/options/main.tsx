import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import { bettersLightTheme } from "../panel/theme";
import { OptionsApp } from "./OptionsApp";

createRoot(document.getElementById("root")!).render(
  <FluentProvider theme={bettersLightTheme}>
    <OptionsApp />
  </FluentProvider>
);
