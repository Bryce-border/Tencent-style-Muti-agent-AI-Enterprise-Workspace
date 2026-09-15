import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthBoundary } from "./auth";
import "./styles.css";
import "./glass.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthBoundary>
        <App />
      </AuthBoundary>
    </BrowserRouter>
  </React.StrictMode>,
);
