import React from "react";
import ReactDOM from "react-dom/client";
import { configureNativeHttp } from "./services/native";
import App from "./App";
import "./styles.css";

configureNativeHttp();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
